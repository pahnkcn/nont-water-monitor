import type { Metadata, Viewport } from "next";
import { Anuphan, Taviraj } from "next/font/google";
import "./globals.css";

// Anuphan: a looped Thai face that stays readable for older residents at small sizes,
// with Latin numerals that hold up at display size.
const anuphan = Anuphan({
  variable: "--font-ui",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Taviraj: traditional Thai serif, used only for the wordmark, like the hall's gilt signboard.
const taviraj = Taviraj({
  variable: "--font-sign",
  subsets: ["thai", "latin"],
  weight: ["600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "ระดับน้ำท่าน้ำนนท์",
  description:
    "อ่านระดับน้ำจากไม้วัดในกล้อง CCTV ท่าน้ำนนท์ทุก 10 นาที พร้อมแจ้งเตือนเข้ามือถือเมื่อถึงระดับเฝ้าระวังหรืออันตราย",
  applicationName: "ระดับน้ำท่าน้ำนนท์",
  appleWebApp: { capable: true, title: "น้ำท่าน้ำนนท์", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#22302F" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1110" },
  ],
};

// Applies the saved theme before first paint so night mode never flashes white.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${anuphan.variable} ${taviraj.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
