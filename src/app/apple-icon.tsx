import { ImageResponse } from "next/og";

// iOS home-screen / "Add to Home Screen" icon. 180×180 is the size iOS pulls
// for retina home screens. Full-bleed emerald — iOS applies its own rounded
// mask, so we don't round the corners ourselves. Mirrors the `icon.tsx` mark.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#059669",
          color: "white",
          fontSize: 132,
          fontWeight: 700,
        }}
      >
        N
      </div>
    ),
    { ...size },
  );
}
