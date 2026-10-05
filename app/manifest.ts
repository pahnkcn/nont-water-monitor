import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ระดับน้ำท่าน้ำนนท์",
    short_name: "น้ำท่าน้ำนนท์",
    description: "ระดับน้ำจากไม้วัดในกล้อง CCTV ท่าน้ำนนท์ พร้อมแจ้งเตือนเข้ามือถือ",
    lang: "th",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#e4e6e1",
    theme_color: "#22302f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
