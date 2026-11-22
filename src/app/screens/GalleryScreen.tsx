import { Gallery } from '../../ui/Gallery.tsx'

/** `#/design`: the design-system gallery, loaded on demand so it stays out of the main bundle. */
export default function GalleryScreen() {
  return <Gallery />
}
