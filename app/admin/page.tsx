import type { Metadata } from "next";
import { AdminPanel } from "@/components/AdminPanel";
import { PlainHeader } from "@/components/PlainHeader";

export const metadata: Metadata = { title: "ผู้ดูแล · ระดับน้ำท่าน้ำนนท์", robots: { index: false } };

export default function Admin() {
  return (
    <>
      <PlainHeader />
      <main className="page" id="main" style={{ display: "block" }}>
        <AdminPanel />
      </main>
    </>
  );
}
