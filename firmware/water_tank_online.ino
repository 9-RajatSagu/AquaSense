// AquaSense - ESP32 water tank controller
// Ultrasonic level + automatic fill + pump commands from the website.
// Relay is driven by a BC547 (HIGH = relay ON).
//
// The pump logic runs on the ESP32 itself. The website can only ask for a start
// or a stop. The ESP32 checks its own safety rules, then reports what it did.

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ---- Wi-Fi + website (EDIT THESE) ----
const char* WIFI_SSID  = "YOUR_WIFI_NAME";
const char* WIFI_PASS  = "YOUR_WIFI_PASSWORD";
// Before hosting: http://<laptop-ip>:8000  |  After hosting: https://api.yourdomain.com
const char* SERVER_URL = "http://192.168.1.10:8000";
// Copy both values from the website: Devices -> New device (the key is shown only once)
const char* DEVICE_ID  = "AQ-XXXX-XXXX";
const char* DEVICE_KEY = "PASTE_DEVICE_KEY_HERE";

const unsigned long SEND_EVERY_MS = 5000;

// ---- Pins ----
const int RELAY_PIN  = 26;  // -> 2.2k -> BC547 base
const int SENSOR_PIN = 35;  // HC-SR04 ECHO (after 1k / 2.2k divider)
const int TRIG_PIN   = 25;  // HC-SR04 TRIG

// ---- Tank numbers (cm, measured) ----
const float TANK_H_CM = 9.0;    // sensor face to tank bottom
const float FULL_CM   = 3.0;    // distance at 100 %
const float ML_PER_CM = 92.0;   // 500 mL = 5.4 cm of water

// ---- Pump rules ----
float startPct = 25.0;          // auto fill starts at or below this level (server can change)
float stopPct  = 100.0;         // pump stops at or above this level (server can change)
const unsigned long MAX_RUN_MS    = 120000UL;  // one run never lasts longer (tune to your pump)
const unsigned long MANUAL_MAX_MS = 120000UL;  // longest run started from the app
const unsigned long AUTO_HOLD_MS  = 600000UL;  // after Stop from the app, auto start waits this long

// ---- State ----
bool pumpOn = false;
bool locked = false;            // latched by the safety timer
unsigned long pumpStart = 0;

bool autoFilling = false;
bool manualRun = false;
unsigned long manualUntil = 0;
unsigned long autoBlockedUntil = 0;

float lastPct = 0.0;
bool sensorOk = false;

// Command handling: 0 none, 1 checking result, 2 report "done", 3 report "failed"
long cmdId = 0;
bool cmdWantOn = false;
int cmdState = 0;
unsigned long cmdDeadline = 0;
String cmdNote = "";

unsigned long lastSend = 0;
unsigned long lastWifiTry = 0;

void setRelay(bool on) {
  digitalWrite(RELAY_PIN, on ? HIGH : LOW);
  pumpOn = on;
}

float readCm() {
  float v[5];
  for (int i = 0; i < 5; i++) {
    digitalWrite(TRIG_PIN, LOW);  delayMicroseconds(2);
    digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
    digitalWrite(TRIG_PIN, LOW);
    long d = pulseIn(SENSOR_PIN, HIGH, 30000);
    v[i] = (d == 0) ? 999.0 : d * 0.0343 / 2.0;
    delay(30);
  }
  for (int i = 0; i < 4; i++)           // small sort, take the median
    for (int j = 0; j < 4 - i; j++)
      if (v[j] > v[j + 1]) { float t = v[j]; v[j] = v[j + 1]; v[j + 1] = t; }
  return v[2];
}

void updatePump(bool want) {
  if (locked) want = false;                       // safety lock stays until cleared
  if (want && !pumpOn) { setRelay(true); pumpStart = millis(); }
  if (!want && pumpOn) setRelay(false);
  if (pumpOn && millis() - pumpStart > MAX_RUN_MS) {
    setRelay(false);
    locked = true;
    manualRun = false;
    Serial.println("MAX RUN time reached, pump stopped and locked.");
  }
}

// ---- Tiny JSON helpers (no library needed) ----
bool jsonNumber(const String& s, const char* key, int from, float& out) {
  String k = String("\"") + key + "\":";
  int i = s.indexOf(k, from);
  if (i < 0) return false;
  out = s.substring(i + k.length()).toFloat();
  return true;
}

void handleCommand(long id, bool wantOn) {
  cmdId = id;
  cmdWantOn = wantOn;
  cmdDeadline = millis() + 4000;
  if (wantOn) {
    if (!sensorOk) {
      cmdState = 3; cmdNote = "Level sensor error";
    } else if (locked) {
      cmdState = 3; cmdNote = "Safety lock is active";
    } else if (lastPct >= stopPct) {
      cmdState = 3; cmdNote = "Tank is full";
    } else {
      manualRun = true;
      manualUntil = millis() + MANUAL_MAX_MS;
      autoBlockedUntil = 0;
      cmdState = 1; cmdNote = "Pump started";
    }
  } else {
    manualRun = false;
    autoFilling = false;
    locked = false;                               // Stop also clears the safety lock
    autoBlockedUntil = millis() + AUTO_HOLD_MS;
    setRelay(false);
    cmdState = 1; cmdNote = "Pump stopped";
  }
}

void applyServerReply(const String& body) {
  int g = body.indexOf("\"config\":{");
  if (g >= 0) {
    float a, b;
    if (jsonNumber(body, "start_pct", g, a) && jsonNumber(body, "stop_pct", g, b)) {
      if (a >= 5 && b <= 100 && b - a >= 10) { startPct = a; stopPct = b; }
    }
  }
  int c = body.indexOf("\"command\":{");
  if (c >= 0) {
    float id;
    if (jsonNumber(body, "id", c, id)) {
      bool wantOn = body.indexOf("\"pump_on\"", c) >= 0;
      handleCommand((long)id, wantOn);
    }
  }
}

void connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 8000) delay(250);
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi OK, IP: "); Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi not connected (pump logic keeps working)");
  }
}

void sendReading(float cm, float waterCm, float ml, float pct, bool valid) {
  String body = "{";
  if (valid) {
    body += "\"distance_cm\":" + String(cm, 1) + ",";
    body += "\"water_cm\":" + String(waterCm, 1) + ",";
    body += "\"volume_ml\":" + String(ml, 0) + ",";
    body += "\"level_pct\":" + String(pct, 1) + ",";
  }
  body += "\"pump_on\":" + String(pumpOn ? "true" : "false") + ",";
  body += "\"locked\":" + String(locked ? "true" : "false");
  if (cmdState >= 2) {
    body += ",\"cmd_id\":" + String(cmdId);
    body += ",\"cmd_status\":\"" + String(cmdState == 2 ? "done" : "failed") + "\"";
    body += ",\"cmd_note\":\"" + cmdNote + "\"";
  }
  body += "}";

  String url = String(SERVER_URL) + "/api/readings";
  HTTPClient http;
  WiFiClientSecure secure;
  WiFiClient plain;
  if (url.startsWith("https")) { secure.setInsecure(); http.begin(secure, url); }
  else                         { http.begin(plain, url); }
  http.setConnectTimeout(2000);
  http.setTimeout(3000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Device-Key", DEVICE_KEY);
  int code = http.POST(body);
  Serial.printf("POST %d\n", code);
  if (code == 201) {
    if (cmdState >= 2) cmdState = 0;              // result delivered
    applyServerReply(http.getString());
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(SENSOR_PIN, INPUT);
  setRelay(false);
  Serial.println("AquaSense: level + auto fill + app control");
  connectWifi();
}

void loop() {
  float cm = readCm();
  sensorOk = (cm < 900 && cm >= 2.0);

  float usable = TANK_H_CM - FULL_CM;
  float waterCm = 0.0, pct = 0.0, ml = 0.0;
  if (sensorOk) {
    waterCm = constrain(TANK_H_CM - cm, 0.0f, usable);
    pct = waterCm / usable * 100.0;
    ml = waterCm * ML_PER_CM;
    lastPct = pct;
  }

  bool want = false;
  if (!sensorOk) {
    autoFilling = false;                          // no valid reading: keep the pump off
    manualRun = false;
  } else {
    if (pct <= startPct && millis() >= autoBlockedUntil) autoFilling = true;
    if (pct >= stopPct) { autoFilling = false; manualRun = false; locked = false; }
    if (manualRun && millis() >= manualUntil) manualRun = false;
    want = autoFilling || manualRun;
  }
  updatePump(want);

  if (cmdState == 1) {                            // check that the pump really did what was asked
    if (pumpOn == cmdWantOn) cmdState = 2;
    else if (millis() > cmdDeadline) { cmdState = 3; cmdNote = "Pump did not change state"; }
  }

  if (sensorOk) {
    Serial.printf("dist=%.1f cm | water=%.1f cm (%.0f mL) | level=%.0f%% | pump=%d locked=%d auto=%d manual=%d\n",
                  cm, waterCm, ml, pct, pumpOn, locked, autoFilling, manualRun);
  } else {
    Serial.println("Sensor error (no echo or too close). Pump OFF.");
  }

  if (WiFi.status() == WL_CONNECTED) {
    if (cmdState >= 2 || millis() - lastSend >= SEND_EVERY_MS) {
      lastSend = millis();
      sendReading(cm, waterCm, ml, pct, sensorOk);
    }
  } else if (millis() - lastWifiTry > 10000) {
    lastWifiTry = millis();
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);             // non-blocking retry, pump logic keeps running
  }

  delay(300);
}
