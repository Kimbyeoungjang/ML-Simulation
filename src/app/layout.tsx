import "./globals.css";

export const metadata = {
  title: "TileForge",
  description: "TPU 계열 타일링 및 하드웨어 공동 설계 워크벤치",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
