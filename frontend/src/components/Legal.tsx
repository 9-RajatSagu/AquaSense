import { CONTACT_EMAIL, OPERATOR_NAME, POLICY_UPDATED } from "../config";
import { Link } from "../lib/router";
import { Logo } from "./Icons";

type Section = { heading: string; body: string[] };

const privacy: Section[] = [
  {
    heading: "Who runs AquaSense",
    body: [
      `AquaSense is a water tank monitoring service run by ${OPERATOR_NAME}. This page explains what personal data we handle and why. Questions can be sent to ${CONTACT_EMAIL}.`,
    ],
  },
  {
    heading: "What we collect",
    body: [
      "Account data: your name, your email address and your password. Passwords are handled by our authentication provider and are stored only as a one-way hash. We cannot read them.",
      "Device data: the readings your ESP32 sends (water level, sensor distance, estimated volume, pump state and time), the events we derive from them, and the settings you choose such as device name, tank capacity and alert level. Device keys are stored only as a hash.",
      "Technical data: our hosting providers may log your IP address, browser type and request times for security and troubleshooting.",
    ],
  },
  {
    heading: "How we use it",
    body: [
      "We use your data to sign you in, show your tank data, keep the service secure and fix faults. We do not sell personal data and we do not show advertising.",
    ],
  },
  {
    heading: "Storage in your browser",
    body: [
      "When you sign in, a session token is kept in your browser so you stay signed in. We also remember which device you last viewed. We do not use advertising cookies, analytics cookies or third-party trackers.",
    ],
  },
  {
    heading: "Who else handles your data",
    body: [
      "We use Supabase for the database and sign-in, and a hosting provider for the website and the API. They process data on our behalf and only to run the service. Their servers may be in other countries.",
      "If you link a device to a second account using its Device ID and key, that account can see the device data. Only share the key with people you trust.",
    ],
  },
  {
    heading: "How long we keep it",
    body: [
      "Readings and events are kept until you remove the device or delete your account. In Settings you can delete your account. Devices that nobody else uses are deleted with all their readings. Backups kept by our providers may hold data for a short time afterwards.",
    ],
  },
  {
    heading: "Security",
    body: [
      "Connections use HTTPS, database tables are closed to direct public access, and device keys are hashed. No online service can promise perfect security, so use a strong password and keep your device key private.",
    ],
  },
  {
    heading: "Your choices",
    body: [
      `You can view and change your device settings in the app, remove devices, and delete your account yourself. To ask for a copy of your data or for other help, write to ${CONTACT_EMAIL}.`,
    ],
  },
  {
    heading: "Children",
    body: ["AquaSense is not meant for children under 13, and we do not knowingly collect their data."],
  },
  {
    heading: "Changes",
    body: ["If this policy changes, we update the date at the top of this page. Larger changes will also be announced in the app."],
  },
];

const terms: Section[] = [
  {
    heading: "Using AquaSense",
    body: [
      `These terms apply when you use AquaSense, provided by ${OPERATOR_NAME}. By creating an account or using the service you agree to them. If you do not agree, please do not use it.`,
    ],
  },
  {
    heading: "Your account",
    body: [
      "Give accurate details and keep your password and device keys private. You are responsible for activity on your account and for any account you link to your devices.",
    ],
  },
  {
    heading: "Your hardware and safety",
    body: [
      "You build, wire and run your own ESP32, sensor, relay and pump. You are responsible for electrical safety, for water damage and for what you connect to the system.",
      "AquaSense is a monitoring tool. Do not rely on it as the only protection against overflow, dry running or leaks. Keep the safety limits in your device sketch, and check your tank and pump yourself.",
    ],
  },
  {
    heading: "Acceptable use",
    body: [
      "Do not try to break, overload or gain access to parts of the service that are not yours. Do not use it to harm others, or to send data that is not from your own devices.",
    ],
  },
  {
    heading: "Accuracy and availability",
    body: [
      "Levels, volumes and usage figures are estimates based on an ultrasonic sensor and your settings. The service may be unavailable, delayed or changed at any time, for example during maintenance or when your device loses its connection.",
    ],
  },
  {
    heading: "Liability",
    body: [
      "The service is provided as it is, without promises about uptime or fitness for a particular purpose. To the extent the law allows, we are not liable for indirect or consequential loss, or for damage caused by hardware, power, water or network faults.",
    ],
  },
  {
    heading: "Ending your use",
    body: [
      "You can stop at any time and delete your account in Settings. We may suspend access that breaks these terms or puts the service at risk.",
    ],
  },
  {
    heading: "Changes and law",
    body: [
      `We may update these terms and will change the date above when we do. Continuing to use the service means you accept the new version. These terms are governed by the laws of India. Questions can be sent to ${CONTACT_EMAIL}.`,
    ],
  },
];

export default function Legal({ kind }: { kind: "privacy" | "terms" }) {
  const isPrivacy = kind === "privacy";
  const sections = isPrivacy ? privacy : terms;

  return (
    <div className="legal">
      <header className="legal-header">
        <Link to="/" className="brand" title="AquaSense home">
          <Logo />
          <span className="brand-name">AquaSense</span>
        </Link>
        <nav className="legal-nav" aria-label="Legal pages">
          <Link to="/privacy" current={isPrivacy}>Privacy Policy</Link>
          <Link to="/terms" current={!isPrivacy}>Terms</Link>
          <Link to="/">Back to app</Link>
        </nav>
      </header>
      <main className="legal-body">
        <p className="eyebrow">Legal</p>
        <h1>{isPrivacy ? "Privacy Policy" : "Terms and Conditions"}</h1>
        <p className="muted-text">Last updated {POLICY_UPDATED}</p>
        {sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </section>
        ))}
      </main>
    </div>
  );
}
