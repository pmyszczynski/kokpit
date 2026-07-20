import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BookmarkTile from "@/components/BookmarkTile";
import type { BookmarkLink } from "@/config/schema";

const links: BookmarkLink[] = [
  {
    name: "GitHub",
    url: "https://github.com",
    icon: "/icons/github.png",
    description: "Code hosting",
  },
  { name: "Grafana docs", url: "https://grafana.com/docs", abbr: "GD" },
];

describe("BookmarkTile", () => {
  it("renders the group name as header and one link per bookmark", () => {
    const { container } = render(
      <BookmarkTile name="Dev" variant="list" size="tall" links={links} />
    );
    expect(
      container.querySelector(".bookmark-tile__header")?.textContent
    ).toBe("Dev");
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("opens links in a new tab", () => {
    render(<BookmarkTile name="Dev" variant="list" size="tall" links={links} />);
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it.each(["list", "icon-grid", "compact"] as const)(
    "renders links with duplicate names without a React key collision (%s)",
    (variant) => {
      const dupLinks: BookmarkLink[] = [
        { name: "Docs", url: "https://a.example.com" },
        { name: "Docs", url: "https://b.example.com" },
      ];
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      render(
        <BookmarkTile name="Dev" variant={variant} size="tall" links={dupLinks} />
      );
      // Both same-named links (distinct URLs) render, and React logged no
      // duplicate-key warning thanks to the composite `${name} ${url}` key.
      const hrefs = screen
        .getAllByRole("link")
        .map((a) => a.getAttribute("href"));
      expect(hrefs).toEqual(["https://a.example.com", "https://b.example.com"]);
      expect(
        errorSpy.mock.calls.some((c) => String(c[0]).includes("same key"))
      ).toBe(false);
      errorSpy.mockRestore();
    }
  );

  it("applies variant and size modifier classes", () => {
    const { container } = render(
      <BookmarkTile name="Dev" variant="icon-grid" size="wide" links={links} />
    );
    const tile = container.querySelector(".bookmark-tile");
    expect(tile).toHaveClass("bookmark-tile--icon-grid");
    expect(tile).toHaveClass("bookmark-tile--wide");
  });

  it("exposes the accent color as a CSS variable", () => {
    const { container } = render(
      <BookmarkTile
        name="Dev"
        accent="#7aa2f7"
        variant="list"
        size="tall"
        links={links}
      />
    );
    const tile = container.querySelector<HTMLElement>(".bookmark-tile");
    expect(tile?.style.getPropertyValue("--bookmark-accent")).toBe("#7aa2f7");
  });

  it("sets no accent variable when accent is omitted (falls back in CSS)", () => {
    const { container } = render(
      <BookmarkTile name="Dev" variant="list" size="tall" links={links} />
    );
    const tile = container.querySelector<HTMLElement>(".bookmark-tile");
    expect(tile?.style.getPropertyValue("--bookmark-accent")).toBe("");
  });

  describe("list variant", () => {
    it("renders names, accent markers and the optional description", () => {
      const { container } = render(
        <BookmarkTile name="Dev" variant="list" size="tall" links={links} />
      );
      expect(screen.getByText("GitHub")).toBeInTheDocument();
      expect(screen.getByText("Code hosting")).toBeInTheDocument();
      expect(container.querySelectorAll(".bookmark-tile__marker")).toHaveLength(2);
    });
  });

  describe("icon-grid variant", () => {
    it("shows only icons; the name lives in title/aria-label; no description", () => {
      const { container } = render(
        <BookmarkTile name="Dev" variant="icon-grid" size="normal" links={links} />
      );
      expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute(
        "title",
        "GitHub"
      );
      expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
      expect(screen.queryByText("Code hosting")).not.toBeInTheDocument();
      expect(container.querySelector("img")).not.toBeNull();
    });
  });

  describe("compact variant", () => {
    it("is text-only: no icons, no abbr, no description", () => {
      const { container } = render(
        <BookmarkTile name="Dev" variant="compact" size="normal" links={links} />
      );
      expect(screen.getByText("GitHub")).toBeInTheDocument();
      expect(screen.getByText("Grafana docs")).toBeInTheDocument();
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector(".bookmark-tile__abbr")).toBeNull();
      expect(screen.queryByText("Code hosting")).not.toBeInTheDocument();
    });
  });

  describe("icon fallback chain", () => {
    it("falls back explicit icon → favicon → abbr", () => {
      const { container } = render(
        <BookmarkTile
          name="Dev"
          variant="list"
          size="tall"
          links={[
            {
              name: "Grafana",
              url: "https://grafana.com/docs",
              icon: "/bad.png",
              abbr: "GD",
            },
          ]}
        />
      );
      // Explicit icon first.
      let img = container.querySelector("img");
      expect(img).toHaveAttribute("src", "/bad.png");

      // Icon fails → site favicon.
      fireEvent.error(img!);
      img = container.querySelector("img");
      expect(img).toHaveAttribute("src", "https://grafana.com/favicon.ico");

      // Favicon fails → 2-char abbr.
      fireEvent.error(img!);
      expect(container.querySelector("img")).toBeNull();
      expect(screen.getByText("GD")).toBeInTheDocument();
    });

    it("falls back to the first letter of the name when no abbr is set", () => {
      const { container } = render(
        <BookmarkTile
          name="Dev"
          variant="list"
          size="tall"
          links={[{ name: "grafana", url: "https://grafana.com" }]}
        />
      );
      // No explicit icon → favicon; favicon fails → first letter, uppercased.
      fireEvent.error(container.querySelector("img")!);
      expect(screen.getByText("G")).toBeInTheDocument();
    });
  });
});
