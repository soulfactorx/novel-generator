import { describe, expect, it } from "vitest";
import { imageProgress, readWithProgress, readingLabel } from "../src/components/ImportProgress";

describe("가져오기 진행률", () => {
  it("이미지 저장 진행률을 % 로 보여 준다", () => {
    expect(imageProgress(1, 4)).toEqual({ label: "이미지 1 / 4장 저장 중", pct: 25 });
    expect(imageProgress(1344, 1344).pct).toBe(100);
  });
  it("파일 크기를 MB로 적는다", () => {
    expect(readingLabel(new File([new Uint8Array(3 * 1048576)], "a.risum"))).toBe("파일 읽는 중 (3.0MB)");
  });
  it("작은 파일은 바로 읽는다", async () => {
    const b = await readWithProgress(new File([new Uint8Array([1, 2, 3])], "a.json"), () => {});
    expect([...b]).toEqual([1, 2, 3]);
  });
});
