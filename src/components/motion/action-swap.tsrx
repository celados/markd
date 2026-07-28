// beui.dev/components/motion/action-swap

import {
  AnimatePresence,
  motion,
  type Variants,
} from "@octanejs/motion";
import {
  type OctaneNode,
  useLayoutEffect,
  useRef,
  useState,
} from "octane";
import { EASE_OUT, EASE_OUT_CSS, SPRING_SWAP } from "@/lib/ease";
import { useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type ActionSwapAnimation = "blur" | "roll" | "cascade";

/** Animations with a single-element variant set (cascade animates per letter). */
type CoreAnimation = "blur" | "roll";

export type ActionSwapTextProps = {
  value: string;
  text: string;
  animation?: ActionSwapAnimation;
  className?: string;
};

export type ActionSwapIconProps = {
  value: string;
  icon: OctaneNode;
  animation?: ActionSwapAnimation;
  className?: string;
};

const BLUR_TRANSITION = { duration: 0.2, ease: "easeInOut" } as const;
const ROLL_TRANSITION = { duration: 0.24, ease: EASE_OUT } as const;
const SWAP_BLUR = "blur(8px)";
const ROLL_BLUR = "blur(6px)";

// Cascade rolls the label one letter at a time, left to right. The leaving
// and landing strings overlap as independent layers (no shared cells), so
// proportional glyph widths never jitter. Exits cascade at half the enter
// stagger so the tail of the old label lingers briefly.
const CASCADE_STAGGER = 0.025;

const CASCADE_LETTER_VARIANTS: Variants = {
  initial: { opacity: 0, y: "105%", filter: ROLL_BLUR },
  animate: (delay: number = 0) => ({
    opacity: 1,
    y: "0%",
    filter: "blur(0px)",
    transition: { ...SPRING_SWAP, delay },
  }),
  exit: (delay: number = 0) => ({
    opacity: 0,
    y: "-105%",
    filter: ROLL_BLUR,
    transition: { duration: 0.16, ease: EASE_OUT, delay: delay * 0.5 },
  }),
};

const TEXT_VARIANTS: Record<CoreAnimation, Variants> = {
  blur: {
    initial: { opacity: 0, scale: 0.94, filter: SWAP_BLUR },
    animate: {
      opacity: 1,
      scale: 1,
      filter: "blur(0px)",
      transition: BLUR_TRANSITION,
    },
    exit: {
      opacity: 0,
      scale: 0.94,
      filter: SWAP_BLUR,
      transition: BLUR_TRANSITION,
    },
  },
  roll: {
    initial: { opacity: 0, y: "115%", filter: ROLL_BLUR },
    animate: {
      opacity: 1,
      y: "0%",
      filter: "blur(0px)",
      transition: ROLL_TRANSITION,
    },
    exit: {
      opacity: 0,
      y: "-115%",
      filter: ROLL_BLUR,
      transition: { duration: 0.18, ease: "easeInOut" },
    },
  },
};

const ICON_VARIANTS: Record<CoreAnimation, Variants> = {
  blur: {
    initial: { opacity: 0, scale: 0.25, filter: SWAP_BLUR },
    animate: {
      opacity: 1,
      scale: 1,
      filter: "blur(0px)",
      transition: BLUR_TRANSITION,
    },
    exit: {
      opacity: 0,
      scale: 0.25,
      filter: SWAP_BLUR,
      transition: BLUR_TRANSITION,
    },
  },
  roll: {
    initial: { opacity: 0, y: 16, filter: ROLL_BLUR },
    animate: {
      opacity: 1,
      y: 0,
      filter: "blur(0px)",
      transition: ROLL_TRANSITION,
    },
    exit: {
      opacity: 0,
      y: -16,
      filter: ROLL_BLUR,
      transition: { duration: 0.18, ease: "easeInOut" },
    },
  },
};

export function ActionSwapText(props: ActionSwapTextProps) @{
  const { value, text, animation = "blur", className } = props;
  const reduce = useReducedMotion();
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [width, setWidth] = useState<number>();

  useLayoutEffect(() => {
    const nextWidth = measureRef.current?.offsetWidth;
    if (!nextWidth) return;
    setWidth((currentWidth) =>
      currentWidth === nextWidth ? currentWidth : nextWidth,
    );
  });

  const cascade = animation === "cascade" && !reduce;
  const letters = text
    .split("")
    .map((char, index) => ({ char, index }));
  const coreAnimation: CoreAnimation =
    animation === "cascade" ? "roll" : animation;

  <span
    className={cn(
      "relative inline-block overflow-hidden whitespace-nowrap align-bottom",
      className,
    )}
    style={{
      width,
      transition: reduce ? undefined : `width 220ms ${EASE_OUT_CSS}`,
    }}
  >
    <span
      ref={measureRef}
      aria-hidden
      className="invisible inline-block whitespace-nowrap"
    >
      {text}
    </span>
    @if (cascade) {
      <>
        {/* Letters are decorative fragments; readers get the whole label. */}
        <span className="sr-only">{text}</span>
        <AnimatePresence initial={false}>
          <motion.span
            key={`cascade-${value}`}
            aria-hidden
            initial="initial"
            animate="animate"
            exit="exit"
            className="absolute left-0 top-0 inline-block whitespace-pre"
          >
            @for (const letter of letters; key letter.index) {
              <motion.span
                custom={letter.index * CASCADE_STAGGER}
                variants={CASCADE_LETTER_VARIANTS}
                className="inline-block whitespace-pre will-change-[opacity,filter,transform]"
              >
                {letter.char}
              </motion.span>
            }
          </motion.span>
        </AnimatePresence>
      </>
    } @else {
      <AnimatePresence initial={false}>
        <motion.span
          key={`${animation}-${value}`}
          variants={TEXT_VARIANTS[coreAnimation]}
          initial={reduce ? false : "initial"}
          animate={
            reduce
              ? { opacity: 1, filter: "blur(0px)", scale: 1, y: 0 }
              : "animate"
          }
          exit={reduce ? undefined : "exit"}
          className="absolute left-0 top-0 inline-block will-change-[opacity,filter,transform]"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    }
  </span>
}

export function ActionSwapIcon(props: ActionSwapIconProps) @{
  const { value, icon, animation = "blur", className } = props;
  const reduce = useReducedMotion();
  // Icons are single elements — cascade maps to its closest motion, roll.
  const coreAnimation: CoreAnimation =
    animation === "cascade" ? "roll" : animation;

  <span
    className={cn(
      "relative inline-grid shrink-0 place-items-center overflow-hidden",
      className,
    )}
  >
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={`${animation}-${value}`}
        aria-hidden
        variants={ICON_VARIANTS[coreAnimation]}
        initial={reduce ? false : "initial"}
        animate={
          reduce
            ? { opacity: 1, filter: "blur(0px)", scale: 1, y: 0 }
            : "animate"
        }
        exit={reduce ? undefined : "exit"}
        className="col-start-1 row-start-1 inline-flex items-center justify-center will-change-[opacity,filter,transform]"
      >
        {icon}
      </motion.span>
    </AnimatePresence>
  </span>
}
