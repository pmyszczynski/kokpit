import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NetdataCpuWidget } from "@/integrations/netdata/cpuWidget";
import { NetdataRamWidget } from "@/integrations/netdata/ramWidget";
import { NetdataNetWidget } from "@/integrations/netdata/netWidget";
import { NetdataDiskIoWidget } from "@/integrations/netdata/diskIoWidget";
import { NetdataDiskSpaceWidget } from "@/integrations/netdata/diskSpaceWidget";
import { NetdataLoadWidget } from "@/integrations/netdata/loadWidget";
import { NetdataSensorWidget } from "@/integrations/netdata/sensorWidget";

const noop = () => {};

// ---------------------------------------------------------------------------
// NetdataCpuWidget
// ---------------------------------------------------------------------------

describe("NetdataCpuWidget", () => {
  it("renders current CPU percentage", () => {
    render(
      <NetdataCpuWidget
        data={{ current: 45.2, history: [] }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("45.2%")).toBeInTheDocument();
  });

  it("shows loading hint when data is null and loading", () => {
    render(<NetdataCpuWidget data={null} loading={true} error={null} refresh={noop} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <NetdataCpuWidget
        data={null}
        loading={false}
        error="Netdata responded with 401"
        refresh={noop}
      />
    );
    expect(screen.getByText("Netdata responded with 401")).toBeInTheDocument();
  });

  it("shows stale error alongside data when data and error are both set", () => {
    render(
      <NetdataCpuWidget
        data={{ current: 12.0, history: [] }}
        loading={false}
        error="refresh failed"
        refresh={noop}
      />
    );
    expect(screen.getByText("12.0%")).toBeInTheDocument();
    expect(screen.getByText("refresh failed")).toBeInTheDocument();
  });

  it("renders sparkline when history has 2+ values", () => {
    const { container } = render(
      <NetdataCpuWidget
        data={{ current: 20.0, history: [10, 15, 20] }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("does not render sparkline when history is empty", () => {
    const { container } = render(
      <NetdataCpuWidget
        data={{ current: 20.0, history: [] }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NetdataRamWidget
// ---------------------------------------------------------------------------

describe("NetdataRamWidget", () => {
  const GiB = 1024 ** 3;

  it("renders used and total RAM in appropriate units", () => {
    render(
      <NetdataRamWidget
        data={{ usedBytes: 8 * GiB, totalBytes: 16 * GiB, history: [] }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("8.0 GB")).toBeInTheDocument();
    expect(screen.getByText(/of 16\.0 GB/)).toBeInTheDocument();
  });

  it("shows loading hint when data is null", () => {
    render(<NetdataRamWidget data={null} loading={true} error={null} refresh={noop} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error when data is null and error is set", () => {
    render(
      <NetdataRamWidget data={null} loading={false} error="conn refused" refresh={noop} />
    );
    expect(screen.getByText("conn refused")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NetdataNetWidget
// ---------------------------------------------------------------------------

describe("NetdataNetWidget", () => {
  it("renders inbound and outbound speeds", () => {
    render(
      <NetdataNetWidget
        data={{ inBps: 2_300_000, outBps: 500_000, inHistory: [], outHistory: [] }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText(/↓ 2\.3 MB\/s/)).toBeInTheDocument();
    expect(screen.getByText(/↑ 500\.0 KB\/s/)).toBeInTheDocument();
  });

  it("shows loading hint when data is null", () => {
    render(<NetdataNetWidget data={null} loading={true} error={null} refresh={noop} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NetdataDiskIoWidget
// ---------------------------------------------------------------------------

describe("NetdataDiskIoWidget", () => {
  it("renders read and write speeds", () => {
    render(
      <NetdataDiskIoWidget
        data={{ readBps: 45_000_000, writeBps: 12_000_000, readHistory: [], writeHistory: [] }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText(/R 45\.0 MB\/s/)).toBeInTheDocument();
    expect(screen.getByText(/W 12\.0 MB\/s/)).toBeInTheDocument();
  });

  it("shows loading hint when data is null", () => {
    render(<NetdataDiskIoWidget data={null} loading={true} error={null} refresh={noop} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NetdataDiskSpaceWidget
// ---------------------------------------------------------------------------

describe("NetdataDiskSpaceWidget", () => {
  const GiB = 1024 ** 3;

  it("renders used, total, and percentage", () => {
    render(
      <NetdataDiskSpaceWidget
        data={{ usedBytes: 234 * GiB, totalBytes: 512 * GiB }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("234.0 GB")).toBeInTheDocument();
    // 234/512 = 45.7% → rounds to 46
    expect(screen.getByText(/of 512\.0 GB \(46%\)/)).toBeInTheDocument();
  });

  it("shows loading hint when data is null", () => {
    render(<NetdataDiskSpaceWidget data={null} loading={true} error={null} refresh={noop} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows 0% when totalBytes is zero (no divide-by-zero)", () => {
    render(
      <NetdataDiskSpaceWidget
        data={{ usedBytes: 0, totalBytes: 0 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText(/0%/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NetdataLoadWidget
// ---------------------------------------------------------------------------

describe("NetdataLoadWidget", () => {
  it("renders 1m, 5m, 15m load averages", () => {
    render(
      <NetdataLoadWidget
        data={{ one: 1.20, five: 0.95, fifteen: 0.82 }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText("1.20")).toBeInTheDocument();
    expect(screen.getByText("0.95")).toBeInTheDocument();
    expect(screen.getByText("0.82")).toBeInTheDocument();
  });

  it("shows loading hint when data is null", () => {
    render(<NetdataLoadWidget data={null} loading={true} error={null} refresh={noop} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// NetdataSensorWidget
// ---------------------------------------------------------------------------

describe("NetdataSensorWidget", () => {
  it("renders sensor value with °C unit", () => {
    render(
      <NetdataSensorWidget
        data={{ value: 54.0, units: "Celsius", history: [], label: "CPU Temp" }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText(/54\.0°C/)).toBeInTheDocument();
    expect(screen.getByText("CPU Temp")).toBeInTheDocument();
  });

  it("renders sensor value with °F unit", () => {
    render(
      <NetdataSensorWidget
        data={{ value: 130.0, units: "Fahrenheit", history: [], label: "Disk Temp" }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText(/130\.0°F/)).toBeInTheDocument();
  });

  it("renders sensor value with arbitrary units", () => {
    render(
      <NetdataSensorWidget
        data={{ value: 1200, units: "RPM", history: [], label: "Fan" }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(screen.getByText(/1200\.0 RPM/)).toBeInTheDocument();
  });

  it("shows loading hint when data is null", () => {
    render(<NetdataSensorWidget data={null} loading={true} error={null} refresh={noop} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("shows error message when data is null and error is set", () => {
    render(
      <NetdataSensorWidget
        data={null}
        loading={false}
        error='Chart "sensors.none" not found'
        refresh={noop}
      />
    );
    expect(screen.getByText(/not found/)).toBeInTheDocument();
  });

  it("renders sparkline when history has 2+ values", () => {
    const { container } = render(
      <NetdataSensorWidget
        data={{ value: 50, units: "Celsius", history: [48, 50, 52], label: "Temp" }}
        loading={false}
        error={null}
        refresh={noop}
      />
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
