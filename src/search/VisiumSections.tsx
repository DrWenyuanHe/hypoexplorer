// The gene page's HYPOMAP Visium section images: a button on the Visium tile
// for a curated gene, opening all nine sections in a modal, each as a pair:
// the authors' regional clusters (main nuclei labelled) and the gene. The
// images are precomputed (src/search/visiumSectionIndex.ts); nothing is drawn here.

import { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { labelInk, loadSectionIndex, sectionImageUrl, type VisiumSectionIndex } from './visiumSectionIndex';

let indexRequest: Promise<VisiumSectionIndex | null> | null = null;
/** One index request per session; a failure is forgotten so a later visit retries. */
function sectionIndex(): Promise<VisiumSectionIndex | null> {
  indexRequest ??= loadSectionIndex().then((index) => {
    if (!index) indexRequest = null;
    return index;
  });
  return indexRequest;
}

/** Test seam. */
export function resetSectionIndex(): void { indexRequest = null; }

function Sections({ gene, index, images }: { gene: string; index: VisiumSectionIndex; images: VisiumSectionIndex['genes'][number]['images'] }) {
  const colour = new Map(index.regions.colours.map((entry) => [entry.key, entry.colour]));
  return (
    <div className="visium-sections">
      <div className="visium-sections-legend">
        <span className="visium-sections-scale" aria-hidden="true"
          style={{ background: `linear-gradient(to right, ${index.scale.stops.join(', ')})` }} />
        <span className="visium-sections-ticks" aria-hidden="true"><span>{index.scale.min}</span><span>{index.scale.max}+</span></span>
        <p className="portal-note">
          {gene}: {index.value}, from {index.scale.min} to {index.scale.max}; higher values are {index.scale.above}. {index.order}
        </p>
      </div>
      <ol className="visium-sections-grid">
        {images.map((image) => {
          const frame = index.sections[image.section - 1];
          const regions = index.regions.images[image.section - 1];
          const labels = index.regions.labels.filter((label) => label.section === image.section);
          return (
            <li key={image.file}>
              <span className="visium-sections-label">{frame.label}</span>
              <div className="visium-sections-pair">
                <figure className="visium-sections-map">
                  <img src={sectionImageUrl(regions)} width={frame.width} height={frame.height} loading="lazy" decoding="async"
                    alt={`Regional clusters in ${frame.label} of 9${labels.length ? `, labelled ${labels.map((label) => label.region).join(', ')}` : ''}.`} />
                  {labels.map((label) => (
                    <span key={label.region} aria-hidden="true"
                      className={`visium-sections-tag visium-sections-tag--${labelInk(colour.get(label.region) ?? '#FFFFFF')}`}
                      style={{ left: `${(100 * label.x) / frame.width}%`, top: `${(100 * label.y) / frame.height}%` }}>
                      {label.region}
                    </span>
                  ))}
                  <figcaption>Regions</figcaption>
                </figure>
                <figure className="visium-sections-map">
                  <img src={sectionImageUrl(image)} width={frame.width} height={frame.height} loading="lazy" decoding="async"
                    alt={`${gene} in ${frame.label} of 9 (${frame.spots.toLocaleString('en-US')} spots), coloured by log-normalised expression.`} />
                  <figcaption>{gene}</figcaption>
                </figure>
              </div>
            </li>
          );
        })}
      </ol>
      <ul className="visium-sections-key" aria-label="Regional cluster colours">
        {index.regions.colours.map((entry) => (
          <li key={entry.key}>
            <span className="visium-sections-swatch" style={{ background: entry.colour }} aria-hidden="true" />
            {entry.key}{entry.name && entry.name !== entry.key ? <span className="visium-sections-name"> {entry.name}</span> : null}
          </li>
        ))}
      </ul>
      {index.notes.map((note) => <p key={note} className="portal-note">{note}</p>)}
      <p className="portal-note portal-credit">
        {index.credit} <a href={index.licenseUrl} target="_blank" rel="noreferrer">{index.license}</a>.
      </p>
    </div>
  );
}

export function VisiumSectionsButton({ gene }: { gene: string }) {
  const [index, setIndex] = useState<VisiumSectionIndex | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void sectionIndex().then((loaded) => { if (live) setIndex(loaded); });
    return () => { live = false; };
  }, []);
  const entry = index?.genes.find((candidate) => candidate.symbol === gene);
  if (!index) return null;
  if (!entry) {
    return (
      <p className="portal-note visium-sections-note">
        Section images are precomputed for {index.genes.length} marker genes: {index.genes.map((candidate) => candidate.symbol).join(', ')}.
      </p>
    );
  }
  return (
    <>
      <button type="button" className="visium-sections-open" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {gene} on all {index.sections.length} sections
      </button>
      {open && (
        <Modal title={`${gene} · HYPOMAP Visium sections`} onClose={() => setOpen(false)} width="min(1200px, 96vw)" height="auto">
          <Sections gene={gene} index={index} images={entry.images} />
        </Modal>
      )}
    </>
  );
}
