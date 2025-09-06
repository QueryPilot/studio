import { forwardRef } from "react";
import {
  OverlayScrollbarsComponent,
  OverlayScrollbarsComponentRef,
} from "overlayscrollbars-react";
import { OverlayScrollbars } from "overlayscrollbars";
import type { OverlayScrollbarsComponentProps } from "overlayscrollbars-react";

interface CustomScrollbarProps extends OverlayScrollbarsComponentProps {
  className?: string;
  style?: React.CSSProperties;
}

export const CustomScrollbar = forwardRef<
  OverlayScrollbarsComponentRef,
  CustomScrollbarProps
>(({ children, className, style, options, ...props }, ref) => {
  return (
    <OverlayScrollbarsComponent
      ref={ref}
      className={className}
      style={style}
      options={{
        paddingAbsolute: false,
        showNativeOverlaidScrollbars: false,
        update: {
          elementEvents: [["img", "load"]],
          debounce: [0, 33],
          attributes: null,
          ignoreMutation: null,
        },
        overflow: {
          x: "scroll",
          y: "scroll",
        },
        scrollbars: {
          theme: "os-theme-custom",
          visibility: "auto",
          autoHide: "leave",
          autoHideDelay: 800,
          autoHideSuspend: false,
          dragScroll: true,
          clickScroll: false,
          pointers: ["mouse", "touch", "pen"],
        },
        ...options,
      }}
      {...props}
    >
      {children}
    </OverlayScrollbarsComponent>
  );
});

CustomScrollbar.displayName = "CustomScrollbar";

// Initialize global scrollbar for body
export const initializeGlobalScrollbar = () => {
  if (typeof window !== "undefined" && document.body) {
    OverlayScrollbars(document.body, {
      paddingAbsolute: false,
      showNativeOverlaidScrollbars: false,
      update: {
        elementEvents: [["img", "load"]],
        debounce: [0, 33],
      },
      overflow: {
        x: "hidden",
        y: "scroll",
      },
      scrollbars: {
        theme: "os-theme-custom",
        visibility: "auto",
        autoHide: "leave",
        autoHideDelay: 800,
        autoHideSuspend: false,
        dragScroll: true,
        clickScroll: false,
        pointers: ["mouse", "touch", "pen"],
      },
    });
  }
};