import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const inputVariants = cva(
  "bg-input/20 dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-md border transition-[border-color,box-shadow] duration-150 focus-visible:ring-[2px] aria-invalid:ring-[2px] file:text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      size: {
        default: "h-7 px-2 py-0.5 text-sm md:text-xs/relaxed file:h-6 file:text-xs/relaxed file:font-medium",
        xs: "h-5 px-1.5 py-0 text-xs file:h-4 file:text-[0.625rem] file:font-medium",
        sm: "h-6 px-2 py-0.5 text-xs file:h-5 file:text-xs file:font-medium",
        lg: "h-8 px-2.5 py-1 text-sm file:h-7 file:text-sm file:font-medium",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function Input({ className, type, size = "default", ...props }: Omit<React.ComponentProps<"input">, "size"> & VariantProps<typeof inputVariants>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(inputVariants({ size }), className)}
      {...props}
    />
  )
}

export { Input, inputVariants }
