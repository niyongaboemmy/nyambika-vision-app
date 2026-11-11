/** Shared between the server layout and the client theme hook (no "use client": the layout needs the string). */
export const THEME_COOKIE = "nv-theme";

/** Runs in <head> before first paint: cookie choice, else the OS preference → <html data-theme>. Tiny + dependency-free. */
export const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark|system)/),p=m?m[1]:"system",d=p==="system"?(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p,e=document.documentElement;e.dataset.theme=d;e.dataset.themePref=p;}catch(_){}})()`;
