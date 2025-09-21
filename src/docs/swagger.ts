// src/docs/swagger.ts
import swaggerJSDoc from 'swagger-jsdoc';

/**
 * Build Swagger/OpenAPI spec.
 * In dev (ts-node), scan .ts; in prod (compiled), scan .js in /dist.
 */
const isProd = process.env.NODE_ENV === 'production';

export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'CNC API',
      version: '1.0.0',
      description: 'API documentation for CNC endpoints',
    },
    servers: [{ url: 'http://localhost:3000', description: 'Local dev' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: isProd
    ? ['./dist/src/routes/**/*.js', './dist/src/controllers/**/*.js']
    : ['./src/routes/**/*.ts', './src/controllers/**/*.ts'],
});

export default swaggerSpec;
