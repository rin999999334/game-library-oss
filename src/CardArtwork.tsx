import { CardImage, Icon } from './ui';
import './card-artwork.css';

type ImageProps = { url: string; name: string; sizingKey?: string; fallbackUrl?: string };

export function CardArtwork({ url, name, sizingKey, fallbackUrl, onExpand }: ImageProps & { onExpand: () => void }) {
  return (
    <button type="button" className="card-artwork" onClick={onExpand} aria-label={name + 'の画像を拡大'}>
      <CardImage url={url} name={name} sizingKey={sizingKey} fallbackUrl={fallbackUrl} eager />
      <span className="card-artwork-expand"><Icon name="expand" /></span>
    </button>
  );
}

export function ExpandedCardImage({ url, name, sizingKey, fallbackUrl }: ImageProps) {
  return (
    <div className="card-image-viewer">
      <CardImage url={url} name={name} sizingKey={sizingKey} fallbackUrl={fallbackUrl} eager />
    </div>
  );
}
