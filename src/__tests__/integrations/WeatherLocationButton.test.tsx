import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { WeatherLocationButton } from "@/integrations/weather/WeatherLocationButton";

let succeed: PositionCallback;
let fail: PositionErrorCallback | null;
const getCurrentPosition = vi.fn<Geolocation["getCurrentPosition"]>();
const coordinates = { latitude: 51.5074567, longitude: -0.1278456 };
function position(coords = coordinates): GeolocationPosition {
  return { coords: { ...coords, accuracy: 50, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) }, timestamp: Date.now(), toJSON: () => ({}) };
}
function error(code: number): GeolocationPositionError {
  return { code, message: "Provider detail must not be displayed", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
}
function start() { fireEvent.click(screen.getByRole("button", { name: "Use my location" })); }

beforeEach(() => {
  vi.stubGlobal("isSecureContext", true);
  getCurrentPosition.mockReset().mockImplementation((success, failure) => { succeed = success; fail = failure ?? null; });
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("WeatherLocationButton", () => {
  it("requests once only after a click, rounds coordinates and announces success", () => {
    const onDetect = vi.fn();
    const { rerender } = render(<WeatherLocationButton latitude={1} longitude={2} onDetect={onDetect} />);
    const announcement = screen.getByRole("status");
    expect(announcement).toBeEmptyDOMElement();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    start();
    expect(screen.getByRole("button", { name: "Cancel location detection" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(/permission/);
    expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), {
      enableHighAccuracy: false, maximumAge: 300_000, timeout: 60_000,
    });
    act(() => {
      succeed(position());
      // Model the parent's batched config update in onDetect.
      rerender(<WeatherLocationButton latitude={51.507} longitude={-0.128} onDetect={onDetect} />);
    });
    expect(onDetect).toHaveBeenCalledExactlyOnceWith({ latitude: 51.507, longitude: -0.128 });
    expect(screen.getByRole("status")).toHaveTextContent(/Review the coordinates/);
    expect(screen.getByRole("status")).toBe(announcement);
    expect(screen.getByRole("button", { name: "Use my location" })).toBeEnabled();
  });

  it.each([[1, /permission was denied/], [2, /location is unavailable/], [3, /could not determine your location within a minute/]])("keeps existing coordinates on error %s and supports retry", (code, message) => {
    const onDetect = vi.fn();
    render(<WeatherLocationButton latitude={1} longitude={2} onDetect={onDetect} />);
    const announcement = screen.getByRole("alert");
    expect(announcement).toBeEmptyDOMElement();
    start(); act(() => fail?.(error(code)));
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("alert")).toBe(announcement);
    expect(screen.getByRole("alert")).toHaveTextContent(/Location Services/);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/Provider detail/);
    expect(onDetect).not.toHaveBeenCalled();
    start(); act(() => succeed(position({ latitude: 0, longitude: 0 })));
    expect(onDetect).toHaveBeenCalledExactlyOnceWith({ latitude: 0, longitude: 0 });
  });

  it.each(["insecure", "unsupported", "throws"])("provides manual-entry guidance when %s", (reason) => {
    if (reason === "insecure") vi.stubGlobal("isSecureContext", false);
    if (reason === "unsupported") vi.stubGlobal("navigator", {});
    if (reason === "throws") getCurrentPosition.mockImplementation(() => { throw new Error("blocked"); });
    const onDetect = vi.fn();
    render(<WeatherLocationButton latitude={1} longitude={2} onDetect={onDetect} />);
    start();
    expect(screen.getByRole("alert")).toHaveTextContent(/manually/);
    expect(onDetect).not.toHaveBeenCalled();
    if (reason !== "throws") expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it.each([{ latitude: NaN, longitude: 0 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: Infinity }, { latitude: 0, longitude: -181 }])("rejects invalid browser coordinates %o", (coords) => {
    const onDetect = vi.fn();
    render(<WeatherLocationButton latitude={1} longitude={2} onDetect={onDetect} />);
    start(); act(() => succeed(position(coords)));
    expect(screen.getByRole("alert")).toHaveTextContent(/invalid location/);
    expect(onDetect).not.toHaveBeenCalled();
  });

  it("accepts a slow result after the original 15-second deadline", () => {
    vi.useFakeTimers();
    const onDetect = vi.fn();
    render(<WeatherLocationButton latitude={1} longitude={2} onDetect={onDetect} />);
    start();
    act(() => vi.advanceTimersByTime(45_000));
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Cancel location detection" })).toBeEnabled();
    act(() => succeed(position()));
    expect(onDetect).toHaveBeenCalledExactlyOnceWith({ latitude: 51.507, longitude: -0.128 });
  });

  it("allows cancellation while waiting for permission and ignores the old result after retry", () => {
    const onDetect = vi.fn();
    render(<WeatherLocationButton latitude={1} longitude={2} onDetect={onDetect} />);
    start(); const oldSuccess = succeed; const oldFailure = fail;
    const control = screen.getByRole("button", { name: "Cancel location detection" });
    control.focus();
    fireEvent.click(control);
    expect(screen.getByRole("button", { name: "Use my location" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Use my location" })).toBe(control);
    expect(control).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Cancel location detection" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    start();
    act(() => { oldSuccess(position()); oldFailure?.(error(1)); });
    expect(onDetect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel location detection" })).toBeEnabled();
    act(() => succeed(position()));
    expect(onDetect).toHaveBeenCalledOnce();
  });

  it("ignores a native timeout's late result after retry", () => {
    const onDetect = vi.fn();
    render(<WeatherLocationButton latitude={1} longitude={2} onDetect={onDetect} />);
    start(); const oldSuccess = succeed; const oldFailure = fail;
    act(() => fail?.(error(3)));
    start();
    act(() => { oldSuccess(position()); oldFailure?.(error(1)); });
    expect(onDetect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel location detection" })).toBeEnabled();
    act(() => succeed(position()));
    expect(onDetect).toHaveBeenCalledOnce();
  });

  it("ignores a pending result after manual coordinate edits", () => {
    const onDetect = vi.fn();
    const { rerender } = render(<WeatherLocationButton latitude={1} longitude={2} onDetect={onDetect} />);
    start();
    rerender(<WeatherLocationButton latitude={10} longitude={2} onDetect={onDetect} />);
    act(() => succeed(position()));
    expect(onDetect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Use my location" })).toBeEnabled();
    rerender(<WeatherLocationButton latitude={1} longitude={2} onDetect={onDetect} />);
    expect(screen.getByRole("button", { name: "Use my location" })).toBeEnabled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("ignores callbacks when the form closes or widget changes", () => {
    vi.useFakeTimers();
    const onDetect = vi.fn();
    const { unmount } = render(<WeatherLocationButton latitude={1} longitude={2} onDetect={onDetect} />);
    start(); unmount();
    act(() => { succeed(position()); fail?.(error(1)); });
    expect(onDetect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
