// Las imágenes se importan como su dirección ya resuelta (lo hace Vite).
declare module "*.png" {
  const url: string;
  export default url;
}
