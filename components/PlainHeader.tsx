import Link from "next/link";

export function PlainHeader() {
  return (
    <header className="site-head" data-status="normal">
      <div className="site-head__bar">
        <Link className="wordmark" href="/">
          ระดับน้ำท่าน้ำนนท์
        </Link>
        <Link href="/" style={{ color: "#ffffff", fontWeight: 600 }}>
          กลับหน้าหลัก
        </Link>
      </div>
    </header>
  );
}
