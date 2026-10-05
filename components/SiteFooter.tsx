"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { MoonIcon } from "./icons";

const DARK = "(prefers-color-scheme: dark)";

function subscribeTheme(onChange: () => void) {
  const mq = window.matchMedia(DARK);
  mq.addEventListener("change", onChange);
  window.addEventListener("themechange", onChange);
  return () => {
    mq.removeEventListener("change", onChange);
    window.removeEventListener("themechange", onChange);
  };
}

function isDark() {
  const saved = document.documentElement.dataset.theme;
  return saved ? saved === "dark" : window.matchMedia(DARK).matches;
}

function ThemeToggle() {
  const dark = useSyncExternalStore<boolean | null>(subscribeTheme, isDark, () => null);

  const toggle = () => {
    const next = !dark;
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // private mode: the choice lasts for this visit only
    }
    window.dispatchEvent(new Event("themechange"));
  };

  return (
    <button type="button" className="btn" onClick={toggle} aria-pressed={dark ?? false} disabled={dark === null}>
      <MoonIcon />
      โหมดกลางคืน
    </button>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-foot">
      <p>
        ค่าที่แสดงเป็นค่าประมาณจากภาพกล้อง ไม่ใช่ข้อมูลทางการ ภาพจากกล้อง CCTV ของ
        <a href="https://cctv-nont.firsttech.co.th/" target="_blank" rel="noopener noreferrer">
          เทศบาลนครนนทบุรี
        </a>{" "}
        ซึ่งสนับสนุนโดยบริษัท เฟิร์สเทค ดีไซน์ จำกัด เว็บนี้ไม่ได้เป็นของหน่วยงานทั้งสอง
      </p>
      <p>
        <Link href="/about">วิธีอ่านค่าและข้อจำกัด</Link>
      </p>
      <div className="btn-row">
        <ThemeToggle />
      </div>
    </footer>
  );
}
