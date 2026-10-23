import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/chat-ui/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] leading-none font-medium',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        success: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-500',
        warning: 'border-amber-500/35 bg-amber-500/10 text-amber-500',
        destructive: 'border-destructive/35 bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: { variant: 'outline' },
  },
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}
function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
