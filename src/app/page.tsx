export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: "1rem",
      }}
    >
      <h1 style={{ fontSize: "2.5rem", fontWeight: 700, letterSpacing: "-0.02em" }}>
        kokpit
      </h1>
      <p style={{ color: "var(--color-text-muted)" }}>
        Your dashboard is being built. Check back soon.
      </p>
    </main>
  );
}
