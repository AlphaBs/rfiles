import { mkdir, writeFile } from 'node:fs/promises';
import SwaggerParser from '@apidevtools/swagger-parser';
import { generateSpecs } from 'hono-openapi';
import { createApp } from '../src/app';
import { openAPIOptions } from '../src/docs';

const document = await generateSpecs(createApp(), openAPIOptions);
// Validate a copy so dereferencing cannot change the generated artifact.
await SwaggerParser.validate(structuredClone(document));
await mkdir('dist', { recursive: true });
await writeFile('dist/openapi.json', `${JSON.stringify(document, null, 2)}\n`);
console.log('Generated and validated dist/openapi.json');
