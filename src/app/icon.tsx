import { ImageResponse } from "next/og";

// Programmatic favicon — an "N" monogram. Avoids shipping a binary .ico and
// keeps the mark in sync with the app's dark/emerald palette.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 24,
          fontWeight: 700,
          borderRadius: 6,
        }}
      >
        N
      </div>
    ),
    { ...size },
  );
}
