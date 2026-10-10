import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,border-color,color,box-shadow] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-[#04121a] font-semibold hover:bg-[#5ee3f5] shadow-[0_0_0_1px_rgb(34_211_238/0.4),0_6px_20px_-8px_rgb(34_211_238/0.6)]",
        secondary: "bg-surface-3 text-fg border border-line-strong hover:bg-[#1c2944] hover:border-[#355078]",
        outline: "border border-line-strong text-fg hover:bg-surface-2 hover:border-[#355078]",
        ghost: "text-muted hover:text-fg hover:bg-surface-2",
        danger: "bg-bad/15 text-bad border border-bad/30 hover:bg-bad/25",
        success: "bg-ok/15 text-ok border border-ok/30 hover:bg-ok/25",
        warning: "bg-warn/15 text-warn border border-warn/30 hover:bg-warn/25",
        link: "text-accent underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-9 px-4",
        lg: "h-11 px-5 text-[15px]",
        xl: "h-14 px-6 text-base rounded-lg",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8",
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
