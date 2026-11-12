import { describe, expect, it } from "vitest";
import { creditGroups, mediaPath, pickCopy, type CreditRow } from "./credits";

const row = (o: Partial<CreditRow>): CreditRow => ({
  path: "public/media/p/v-photo.jpg",
  assetKey: "g25",
  sourceIds: ["g25"],
  title: "Skirt (AM 1970.229-1)",
  author: "Auckland Museum",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Skirt_(AM_1970.229-1).jpg",
  licence: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0",
  shareAlike: false,
  changes: ["resized"],
  illustration: false,
  ...o,
});

describe("credits", () => {
  it("maps image URLs to public media paths only", () => {
    expect(mediaPath("/api/files/public/media/p1/v1-photo.jpg?x=1")).toBe("public/media/p1/v1-photo.jpg");
    expect(mediaPath("http://localhost:3103/api/files/public/media/a.png")).toBe("public/media/a.png");
    expect(mediaPath("public/media/a.png")).toBe("public/media/a.png");
    expect(mediaPath("/api/files/private/twins/u1.enc")).toBeNull();
    expect(mediaPath("/api/files/public/../private/x")).toBeNull();
    expect(mediaPath("")).toBeNull();
  });

  it("groups a photo with its cut-outs and recolours and keeps every change", () => {
    const g = creditGroups([
      row({}),
      row({ path: "public/media/p/v-cutout.png", changes: ["resized", "background removed (cut-out)"] }),
      row({ path: "public/media/p/w-photo.jpg", assetKey: "g25-navy", changes: ["resized", "recoloured (tinted)"] }),
      row({ path: "public/media/q/x.jpg", assetKey: "umushanana-kente", sourceIds: ["s49", "s57"], title: "Kente + Umugongo art", licence: "CC0 1.0", illustration: true }),
    ]);
    expect(g).toHaveLength(2);
    const skirt = g.find((x) => x.key === "g25")!;
    expect(skirt.images).toBe(3);
    expect(skirt.changes).toEqual(["resized", "background removed (cut-out)", "recoloured (tinted)"]);
    expect(g.find((x) => x.key === "s49+s57")!.illustration).toBe(true);
  });

  it("picks the shopper's language and falls back to English", () => {
    const rows = [
      { locale: "en", title: "Ineza A-line dress", description: "", needsReview: false },
      { locale: "rw", title: "Ikanzu Ineza", description: "", needsReview: true },
    ];
    expect(pickCopy(rows, "rw")).toMatchObject({ title: "Ikanzu Ineza", needsReview: true });
    expect(pickCopy(rows, "fr")?.title).toBe("Ineza A-line dress");
    expect(pickCopy(rows, "xx")?.locale).toBe("en");
    expect(pickCopy([], "rw")).toBeNull();
  });
});
