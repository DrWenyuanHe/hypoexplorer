import { isPlainLeftClick } from '../utils/appLinks';
import { BRAND } from './brand';

/** One home link and lockup for every app header. */
export function BrandLink({ onHome }: { onHome?: () => void }) {
  return (
    <a className="site-brand" href={BRAND.home} aria-label={BRAND.label}
      onClick={(event) => {
        if (onHome && isPlainLeftClick(event)) {
          event.preventDefault();
          onHome();
        }
      }}>
      <img src={BRAND.logo} width={BRAND.width} height={BRAND.height} alt="HypoExplorer" />
    </a>
  );
}
