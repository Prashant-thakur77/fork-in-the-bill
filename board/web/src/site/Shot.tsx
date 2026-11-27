import { repo } from "./data";

/** A real screenshot of the Flagsmith dashboard, from docs/img. Renders nothing when the file is not in the repository. */
export function Shot({ name, caption }: { name: string; caption: string }) {
  const s = repo.shots[name];
  if (!s) return null;
  return (
    <figure className="fs-shot" data-reveal="hang">
      <div className="fs-shot-frame">
        <span className="fs-shot-bar" aria-hidden="true">
          <i />
          <i />
          <i />
          <b>Flagsmith dashboard</b>
        </span>
        <img src={`/img/${s.file}`} alt={caption} width={s.width} height={s.height} loading="lazy" decoding="async" />
      </div>
      <figcaption>{caption} Screenshot, not redrawn.</figcaption>
    </figure>
  );
}
