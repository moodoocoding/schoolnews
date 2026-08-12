import type { PostVisual } from "@/contracts";
import styles from "@/styles/gallery.module.css";

import { getPatternProperties } from "./presentation";

export function PatternVisual({ visual }: { visual: PostVisual }) {
  return (
    <div
      aria-hidden="true"
      className={styles.patternVisual}
      data-template={visual.templateVersion}
      style={getPatternProperties(visual.seed)}
    >
      <span className={styles.patternOrb} />
      <span className={styles.patternLine} />
    </div>
  );
}
