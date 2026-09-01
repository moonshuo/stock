import "./globals.css";

export const metadata = {
  title: "股票分类库",
  description: "按板块、细分方向整理和检索股票"
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
