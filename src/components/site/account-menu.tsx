"use client";

import Link from "next/link";
import { useRef } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/*
  The signed-in links for phones, where the header has no room to show them:
  Projects, Admin for admins, Account, and Sign out. Sign out submits the same
  POST form the wide header uses. The form sits outside the popup, so it is
  still in the page when the menu closes on click.
*/
export function AccountMenu({ isAdmin, className }: { isAdmin?: boolean; className?: string }) {
  const signOutForm = useRef<HTMLFormElement>(null);
  return (
    <DropdownMenu>
      <form ref={signOutForm} action="/auth/sign-out" method="post" hidden />
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="Menu" className={cn("-my-1 -mr-2", className)} />}
      >
        <Menu aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44 p-1.5">
        <DropdownMenuLinkItem closeOnClick render={<Link href="/app" />} className="px-2.5 py-2">
          Projects
        </DropdownMenuLinkItem>
        {isAdmin ? (
          <DropdownMenuLinkItem closeOnClick render={<Link href="/admin" />} className="px-2.5 py-2">
            Admin
          </DropdownMenuLinkItem>
        ) : null}
        <DropdownMenuLinkItem closeOnClick render={<Link href="/account" />} className="px-2.5 py-2">
          Account
        </DropdownMenuLinkItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => signOutForm.current?.requestSubmit()} className="px-2.5 py-2">
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
