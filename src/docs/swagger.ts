// src/docs/swagger.ts
import path from 'node:path';
import swaggerJSDoc from 'swagger-jsdoc';

const isTest = process.env.NODE_ENV === 'test';
const isProd = process.env.NODE_ENV === 'production';
const root = process.cwd();

// Helper function to safely create swagger spec
const createSwaggerSpec = () => {
  // Skip full Swagger initialization in test environment
  // This prevents swagger-jsdoc from parsing all TypeScript files during Jest runs
  if (isTest) {
    return {
      openapi: '3.0.3',
      info: {
        title: 'CNC API',
        version: '1.0.0',
        description: 'API documentation (disabled in test mode)',
      },
      paths: {},
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    };
  }

  try {
    const apiPaths = isProd
      ? [
          // In production, read from compiled JS files
          path.join(root, 'dist', 'src', '**', '*.js'),
          // Optional: include YAML fragments
          path.join(root, 'src', 'docs', '**', '*.{yml,yaml}'),
        ]
      : [
          // In development, read from TypeScript files
          path.join(root, 'src', '**', '*.ts'),
          path.join(root, 'src', 'docs', '**', '*.{yml,yaml}'),
        ];

    console.log('Swagger API paths:', apiPaths);
    console.log('Current working directory:', root);
    console.log('Environment:', isProd ? 'production' : 'development');

    const options = {
      definition: {
        openapi: '3.0.3',
        info: {
          title: 'CNC API',
          version: '1.0.0',
          description: 'API documentation for CNC endpoints',
        },
        servers: [
          {
            url: isProd ? 'http://localhost:3000' : 'http://localhost:3000',
            description: isProd ? 'Production' : 'Local dev',
          },
        ],
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
      apis: apiPaths,
    };

    return swaggerJSDoc(options);
  } catch (error) {
    console.error('Failed to initialize Swagger:', error);
    // Return a minimal spec to prevent app crash
    return {
      openapi: '3.0.3',
      info: {
        title: 'CNC API',
        version: '1.0.0',
        description: 'API documentation temporarily unavailable',
      },
      paths: {},
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    };
  }
};

export const swaggerSpec = createSwaggerSpec();

export default swaggerSpec;
