declare module 'swagger-jsdoc' {
  // minimal typing; good enough for typical usage
  export interface SwaggerJSDocOptions {
    definition: Record<string, any>;
    apis: string[];
  }

  export default function swaggerJSDoc(
    options: SwaggerJSDocOptions
  ): Record<string, any>;
}
