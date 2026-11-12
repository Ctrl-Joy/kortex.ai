import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer select-none",
  {
    variants: {
      variant: {
        primary: "bg-fg text-canvas font-semibold hover:bg-white",
        secondary: "bg-surface-3 text-fg hover:bg-line-strong",
        outline: "border border-line-strong text-fg hover:bg-surface-2",
        ghost: "text-muted hover:text-fg hover:bg-surface-2",
        danger: "bg-bad/12 text-bad hover:bg-bad/20",
        success: "bg-ok/12 text-ok hover:bg-ok/20",
        warning: "bg-warn/12 text-warn hover:bg-warn/20",
        link: "text-accent underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-[13px] pointer-coarse:h-11",
        md: "h-9 px-4 pointer-coarse:h-11",
        lg: "h-11 px-5 text-[15px]",
        xl: "h-14 px-6 text-base rounded-xl",
        icon: "h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11",
        "icon-sm": "h-8 w-8 pointer-coarse:h-11 pointer-coarse:w-11",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <LoaderCircle className="animate-spin" aria-hidden />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
