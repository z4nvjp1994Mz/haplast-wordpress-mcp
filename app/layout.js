export const metadata = {
  title: "HAPLAST WordPress MCP",
  description: "MCP bridge between ChatGPT and haplastgroup.com"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
