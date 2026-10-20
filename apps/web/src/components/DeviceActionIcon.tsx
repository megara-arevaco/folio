export function DeviceActionIcon({ type }: { type: "edit" | "download" | "delete" }) {
  return <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {type === "edit" ? <><path d="m14 4 6 6" /><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4z" /></> : type === "download" ? <><path d="M12 3v12m-5-5 5 5 5-5M5 21h14" /></> : <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V3h6v4" /></>}
  </svg>;
}

