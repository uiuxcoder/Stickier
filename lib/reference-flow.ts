export function shouldUseTwoPassReferenceFlow(
  specialRequest: string | undefined,
  identityPhotoCount: number,
  referencePhotoCount: number,
): boolean {
  return (
    identityPhotoCount > 0 &&
    referencePhotoCount > 0 &&
    /meme/i.test(specialRequest ?? "")
  );
}
