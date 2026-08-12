import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name} en .env`);
  }
  return value;
}

export const env = {
  get elevenLabsApiKey() {
    return required("ELEVENLABS_API_KEY");
  },
  get kieAiApiKey() {
    return required("KIE_AI_API_KEY");
  },
  get apifyApiToken() {
    return required("APIFY_API_TOKEN");
  },
  get apifyGoogleImagesTask() {
    return required("APIFY_GOOGLE_IMAGES_TASK");
  },
  get anthropicApiKey() {
    return required("ANTHROPIC_API_KEY");
  },
};
