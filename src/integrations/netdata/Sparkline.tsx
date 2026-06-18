interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function Sparkline({
  values,
  width = 100,
  height = 28,
  color = "var(--color-accent)",
}: SparklineProps) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const pad = height * 0.1;
  const innerH = height - pad * 2;
  const xStep = width / (values.length - 1);

  const pts = values.map((v, i) => ({
    x: i * xStep,
    y: pad + innerH - ((v - min) / range) * innerH,
  }));

  const linePoints = pts.map((p) => `${p.x},${p.y}`).join(" ");

  const areaD = [
    `M ${pts[0].x},${height}`,
    ...pts.map((p) => `L ${p.x},${p.y}`),
    `L ${pts[pts.length - 1].x},${height}`,
    "Z",
  ].join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={areaD} fill={color} fillOpacity={0.15} />
      <polyline
        points={linePoints}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
