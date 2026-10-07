import { expect, it } from "vitest";
import { heraldicBannerGeometry } from "../src/render/banner-wind";

it("builds owner-stable woven borders and distinct muted castle shields", () => {
  const first = heraldicBannerGeometry(4, 10, 6),
    repeated = heraldicBannerGeometry(4, 10, 6),
    second = heraldicBannerGeometry(4, 10, 7),
    firstColors = first.getAttribute("color"),
    repeatedColors = repeated.getAttribute("color"),
    secondColors = second.getAttribute("color");
  expect(firstColors.count).toBe(153);
  expect(Array.from(firstColors.array)).toEqual(Array.from(repeatedColors.array));
  expect(Array.from(firstColors.array)).not.toEqual(Array.from(secondColors.array));
  expect(new Set(Array.from(firstColors.array)).size).toBeGreaterThan(3);
  first.dispose();
  repeated.dispose();
  second.dispose();
});
