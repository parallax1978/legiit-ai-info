import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
  Buttons follow legiitkeywords.com: every primary and secondary button is a pill.
  Primary is brand with the glow shadow; secondary is white with a line ring.
*/
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[background-color,box-shadow,color] outline-none select-none focus-visible:ring-3 focus-visible:ring-brand/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          "rounded-full bg-brand text-white shadow-glow hover:bg-brand-strong hover:shadow-glow",
        secondary:
          "rounded-full bg-white text-ink shadow-sm ring-1 ring-inset ring-line hover:bg-surface-alt hover:ring-line-strong",
        ghost: "rounded-lg text-ink-muted hover:bg-surface-alt hover:text-ink",
        outline:
          "rounded-lg border border-line bg-white text-ink hover:bg-surface-alt",
        destructive:
          "rounded-full bg-bad-soft text-bad hover:bg-bad hover:text-white",
        link: "rounded-none text-brand underline-offset-4 hover:underline",
        onDark:
          "rounded-full bg-white/10 text-white ring-1 ring-inset ring-white/15 backdrop-blur hover:bg-white/15",
      },
      size: {
        xs: "h-7 px-3 text-xs",
        sm: "h-8 px-4 text-xs",
        md: "h-10 px-5 text-sm",
        lg: "h-14 px-6 text-base sm:h-12",
        icon: "size-9 rounded-lg",
        "icon-sm": "size-7 rounded-md",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
