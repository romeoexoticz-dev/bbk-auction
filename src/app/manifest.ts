import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BBK AUCTION",
    short_name: "BBK",
    description: "ระบบประมูลของสะสมของบอล แบงค์เก่า",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f4ee",
    theme_color: "#171713",
    lang: "th",
    icons: [
      { src: "/brand/bbk-auction-logo.png", sizes: "1254x1254", type: "image/png", purpose: "maskable" },
    ],
  };
}
