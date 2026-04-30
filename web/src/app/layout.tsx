import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cotizador Carpinteria",
  description: "Cotizador de cortes y muebles",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b bg-white sticky top-0 z-10">
          <nav className="max-w-7xl mx-auto px-6 py-3 flex gap-6 text-sm">
            <a href="/" className="font-semibold">Cotizador</a>
            <a href="/lista-precios" className="text-gray-700 hover:text-gray-900">Lista de precios</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
