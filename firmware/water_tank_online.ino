// Smart Water Tank Manager - Day 2 (ESP32)
// Ultrasonic level + auto fill. Relay is driven by a BC547 (HIGH = relay ON).

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// ---- Wi-Fi + website (EDIT THESE) ----
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
// Before hosting: http://<laptop-ip>:8000  |  After hosting: https://api.yourdomain.com
const char* SERVER_URL = "http://192.168.1.10:8000";
// Copy both values from the website: Devices -> Add device (the key is shown only once)
const char* DEVICE_ID  = "AQ-XXXX-XXXX";
const char* DEVICE_KEY = "PASTE_DEVICE_KEY_HERE";
const unsigned long SEND_EVERY_MS = 5000;

const int RELAY_PIN  = 26;  // -> 2.2k -> BC547 base
const int SENSOR_PIN = 35;  // HC-SR04 ECHO (after 1k / 2.2k divider)
const int TRIG_PIN   = 25;  // HC-SR04 TRIG

// ---- Tank numbers (measured by you, change after sensor test) ----
const float TANK_H_CM  = 9.0;    // sensor face to tank bottom
const float FULL_CM    = 3.0;    // distance at FULL  -> pump OFF
const float EMPTY_CM   = 7.5;    // distance at LOW   -> pump ON (about 1.5 cm water)
const float ML_PER_CM  = 92.0;   // measured: 500 mL = 5.4 cm of water
const float DEMO_CAPACITY_L = 600.0;  // tank is shown as a 600 L tank (scale model)

// Dry-run / overflow safety: pump never runs longer than this in one fill
const unsigned long MAX_RUN_MS = 120000UL;

bool pumpOn = false;
bool locked = false;
unsigned long pumpStart = 0;

void setRelay(bool on) {
  digitalWrite(RELAY_PIN, on ? HIGH : LOW);
  pumpOn = on;
}

void updatePump(bool want) {
  if (want && !pumpOn && !locked) {
    setRelay(true);
    pumpStart = millis();
  }
  if (!want) {
    setRelay(false);
    locked = false;
  }
  if (pumpOn && millis() - pumpStart > MAX_RUN_MS) {
    setRelay(false);
    locked = true;
    Serial.println("MAX RUN time reached, pump stopped. Reset or change level.");
  }
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
  for (int i = 0; i < 4; i++)           // small sort to take the median
    for (int j = 0; j < 4 - i; j++)
      if (v[j] > v[j + 1]) { float t = v[j]; v[j] = v[j + 1]; v[j + 1] = t; }
  return v[2];
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
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

void sendReading(float cm, float waterCm, float ml, float pct) {
  if (WiFi.status() != WL_CONNECTED) { connectWifi(); return; }
  char body[200];
  snprintf(body, sizeof(body),
    "{\"distance_cm\":%.1f,\"water_cm\":%.1f,\"volume_ml\":%.0f,"
    "\"level_pct\":%.1f,\"pump_on\":%s,\"locked\":%s}",
    cm, waterCm, ml, pct,
    pumpOn ? "true" : "false", locked ? "true" : "false");

  String url = String(SERVER_URL) + "/api/readings";
  HTTPClient http;
  WiFiClientSecure secure;
  WiFiClient plain;
  if (url.startsWith("https")) { secure.setInsecure(); http.begin(secure, url); }
  else                         { http.begin(plain, url); }
  http.setTimeout(4000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Device-Key", DEVICE_KEY);
  int code = http.POST(body);
  Serial.printf("POST %d\n", code);
  http.end();
}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(SENSOR_PIN, INPUT);
  setRelay(false);
  Serial.println("Water tank Day 3: level + auto fill + website");
  connectWifi();
}

void loop() {
  static bool filling = false;
  float cm = readCm();

  if (cm >= 900) {
    Serial.println("No echo, check wiring. Pump OFF.");
    filling = false;
  } else if (cm < 2.0) {
    Serial.println("Too close to sensor (under 2 cm). Pump OFF.");
    filling = false;
  } else {
    if (cm > EMPTY_CM) filling = true;
    if (cm < FULL_CM)  filling = false;

    float usable  = TANK_H_CM - FULL_CM;                       // water height at 100%
    float waterCm = constrain(TANK_H_CM - cm, 0.0, usable);
    float pct     = waterCm / usable * 100.0;
    float realMl  = waterCm * ML_PER_CM;
    float shownL  = pct / 100.0 * DEMO_CAPACITY_L;

    static unsigned long lastSend = 0;
    if (millis() - lastSend >= SEND_EVERY_MS) {
      lastSend = millis();
      sendReading(cm, waterCm, realMl, pct);
    }

    Serial.printf("dist=%.1f cm | water=%.1f cm (%.0f mL) | level=%.0f%% | shown=%.0f L | filling=%d pump=%d\n",
                  cm, waterCm, realMl, pct, shownL, filling, pumpOn);
  }

  updatePump(filling);
  delay(500);
}
