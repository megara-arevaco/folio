/** Decorative cover shared by the device library and reading archive. */
export function BookVolume({ title, authors, coverUrl, label }: { title: string; authors: string[]; coverUrl?: string | null; label?: string }) {
  return <div className="device-book-card__stage" aria-hidden="true">
    <div className="device-book-card__volume">
      <div className="device-book-card__spine"><span>{title}</span></div>
      <div className="device-book-card__pages" />
      <div className="device-book-card__cover">
        <div className="device-book-card__fallback"><span>{authors.join(", ")}</span><strong>{title}</strong><span>{label}</span></div>
        {coverUrl ? <img key={coverUrl} src={coverUrl} alt="" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.hidden = true; }} /> : null}
      </div>
    </div>
  </div>;
}
