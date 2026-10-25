/**
 * How much of the screen the HUD covers, so the 3D scene is framed in the part you can actually see.
 * Pure, so the numbers can be tested. All values in CSS pixels.
 */
export interface Insets { top: number; bottom: number; left: number; right: number }

export interface LayoutInput {
  width: number;
  height: number;
  /** A sheet (cat, object, bag...) is open. */
  sheet: boolean;
  /** Furniture is being moved: the HUD shrinks to a bottom bar. */
  moving: boolean;
}

export function uiInsets({ width, height, sheet, moving }: LayoutInput): Insets {
  const phone = width < 640;
  if (moving) return { top: phone ? 70 : 90, bottom: 110, left: 0, right: 0 };
  if (phone) {
    // top pill + activity strip, then the action row and the dock
    const bottom = sheet ? Math.min(height * 0.5, 380) : 190;
    return { top: 132, bottom, left: 52, right: 0 };
  }
  const right = sheet ? 430 : 170;
  return { top: 108, bottom: 130, left: 92, right };
}

export function freeRect(width: number, height: number, i: Insets) {
  return { w: Math.max(120, width - i.left - i.right), h: Math.max(120, height - i.top - i.bottom) };
}

/** Pixel shift that moves the screen centre to the centre of the free area. */
export function centreShift(i: Insets) {
  return { x: (i.left - i.right) / 2, y: (i.top - i.bottom) / 2 };
}

/** Orthographic zoom (pixels per world unit) that fits a room into the free area. */
export function fitZoom(roomW: number, roomD: number, free: { w: number; h: number }, min = 22, max = 110): number {
  const span = (roomW + roomD) * 0.72;      // width of the iso footprint
  const spanY = (roomW + roomD) * 0.42 + 2.8; // height including walls
  return Math.max(min, Math.min(max, Math.min(free.w / span, free.h / spanY)));
}
