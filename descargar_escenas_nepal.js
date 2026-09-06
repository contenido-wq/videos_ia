/**
 * Descarga las 168 escenas generadas para el video de Nepal, numeradas
 * en orden (escena_000.png a escena_167.png) para que se organicen
 * automáticamente por nombre de archivo.
 *
 * USO (en VS Code):
 * 1. Guarda este archivo en la carpeta donde quieras que caigan las imágenes.
 * 2. Abre una terminal en VS Code (Terminal > New Terminal) en esa carpeta.
 * 3. Corre: node descargar_escenas.js
 * 4. Al terminar, tendrás 168 archivos escena_000.png ... escena_167.png
 *    en la misma carpeta, listos para importar a tu editor en orden.
 *
 * No requiere instalar nada adicional: usa solo módulos nativos de Node.js
 * (https y fs), que ya vienen incluidos si tienes Node instalado.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ESCENAS = [
  { idx: 0, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_023702_6714dfa3-6599-461b-b44a-5443c6f71560.png" },
  { idx: 1, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_023702_46ce47e6-26e7-43a6-9b68-bc0df4762d15.png" },
  { idx: 2, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_023702_c942bc5b-8b49-4e95-84ee-4ae219d75499.png" },
  { idx: 3, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_023702_3ed4f90b-5cc0-4eb5-a369-d6291385a066.png" },
  { idx: 4, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_023702_c87a3908-4305-4119-86de-71df9bb9814f.png" },
  { idx: 5, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_023702_ad558d36-256c-4c56-b1fb-4e3136674193.png" },
  { idx: 6, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_023702_5fb22187-a99c-45ad-9c25-167ea84bf674.png" },
  { idx: 7, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_023702_08573736-f7b8-4fb9-9876-f6c0ddcbdc20.png" },
  { idx: 8, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_023702_528d41e3-f364-4406-87a8-c906f2017423.png" },
  { idx: 9, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_023714_e8066030-51a2-4a21-bf17-7d423eab0975.png" },
  { idx: 10, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_023702_7e667e5d-6552-47fb-aa6e-361e712258de.png" },
  { idx: 11, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_023702_a604cfe8-6ffe-4ef4-a3a5-0074a339387a.png" },
  { idx: 12, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_023722_113c4ee4-4fb2-43e1-9f84-74ece5240c20.png" },
  { idx: 13, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_023722_dc8426d7-8e97-488a-9e75-00dbe7143d90.png" },
  { idx: 14, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_023722_8c09333b-c862-47ae-ac13-c62c5cfb69c6.png" },
  { idx: 15, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024638_854ffe00-e04d-4d26-ade8-b457c5db3a1a.png" },
  { idx: 16, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024638_43a18013-e79f-4a34-bd75-b18ad41f8cb5.png" },
  { idx: 17, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024638_8e84559a-bbb8-4a92-9992-06304a4b07e2.png" },
  { idx: 18, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024638_86c273bc-281a-4d5a-bf76-c89ccd36a19f.png" },
  { idx: 19, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024638_6f809f98-cf9a-47c8-9bca-240b03d391b8.png" },
  { idx: 20, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024638_24424885-7331-4d25-8550-33bb0c37ad9b.png" },
  { idx: 21, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024638_60138cee-0352-4233-9b58-eebeb4462e3f.png" },
  { idx: 22, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024638_97975963-7a04-4127-8516-d47302a4b28b.png" },
  { idx: 23, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024638_9a482bb2-6d62-44b4-a0eb-6914680e6dae.png" },
  { idx: 24, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024638_271762bb-9fe4-46ab-b13a-cf018aa0c270.png" },
  { idx: 25, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024638_e5319b5b-e0a6-4b0c-9e50-a0531e112dd0.png" },
  { idx: 26, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024638_f287b030-8aa9-42b0-850c-dddbfaf11ea2.png" },
  { idx: 27, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024646_75caf3f6-24c9-4649-8de1-68cafb47021c.png" },
  { idx: 28, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024646_71ede3d0-50b0-4f15-bcc5-1e6d2949e74a.png" },
  { idx: 29, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024646_0348d983-1e7d-4ee8-90ed-2d4d4c624f54.png" },
  { idx: 30, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024940_3d34ad08-0002-45ac-961a-43c97730eded.png" },
  { idx: 31, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024940_52552d1b-f7fc-4ccd-a859-49c048a89337.png" },
  { idx: 32, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024940_04092829-3263-40df-902e-665e3c9d660d.png" },
  { idx: 33, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025016_11085a0f-2f92-4d79-a402-60822c8f8243.png" },
  { idx: 34, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024940_8ec807fc-132d-428e-942f-967168106560.png" },
  { idx: 35, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024940_eec284ca-e7dc-422a-a15d-aaf07d17538d.png" },
  { idx: 36, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024940_78d71a74-893f-4725-9f21-ce8ea9f6b991.png" },
  { idx: 37, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024940_612703a1-fd69-4cfe-9904-e1b8a63e0169.png" },
  { idx: 38, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024940_649e7d58-6249-4671-896a-cc1dd06293f1.png" },
  { idx: 39, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024940_5d375664-0c46-409f-b99e-efef5589f29d.png" },
  { idx: 40, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024940_2ca651dc-c89d-478d-8d41-25025d6be7e3.png" },
  { idx: 41, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024940_c5e00b22-bed1-4248-b461-cb3f63b9191c.png" },
  { idx: 42, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024949_1c00d0bd-6d0b-4106-8d45-3977cb3d83c0.png" },
  { idx: 43, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024949_10bec32e-7f6e-41db-818e-726497c87ba0.png" },
  { idx: 44, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_024949_d10c1cfb-816b-4d56-ba00-6f94eb0d712e.png" },
  { idx: 45, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025246_d62e7c67-b53e-4b63-b9ad-9ad4b493f7bf.png" },
  { idx: 46, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025245_5d10081b-9284-4d70-b83c-be48f70ed4fe.png" },
  { idx: 47, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025245_711d6278-5cea-46a8-8625-6e3414d86820.png" },
  { idx: 48, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025245_cf877b0c-a192-4794-8226-af8d9ab41319.png" },
  { idx: 49, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025245_066e456e-b8b4-4179-a0d9-0eef1844955e.png" },
  { idx: 50, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025245_a397fa5d-0397-4f07-953b-b3cb13e47f16.png" },
  { idx: 51, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025245_eabe07ff-1d65-4b2a-a0a0-eb44b81f71ca.png" },
  { idx: 52, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025245_010a5c75-2fc2-405a-bdb2-4c8d739cb55a.png" },
  { idx: 53, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025245_6457f0c2-dcd7-4ac5-bb73-13caff8a07a7.png" },
  { idx: 54, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025245_17b12c45-5ec0-4a7f-99cf-b8e474e414d6.png" },
  { idx: 55, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025245_ac213d1c-4a3f-4c66-821b-099ca9ef7a08.png" },
  { idx: 56, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025245_d7ac5fca-9bda-41b4-ab26-05c64c8b9c27.png" },
  { idx: 57, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025254_55742070-09b7-4974-89d7-1fdd0b8dd389.png" },
  { idx: 58, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025254_9477c4b6-e245-45cc-a9ae-11e96978400c.png" },
  { idx: 59, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_025254_377638c1-b188-433f-ba62-9c389b65deaa.png" },
  { idx: 60, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_030641_35618666-f1fb-4fb4-b0cc-45e80e783494.png" },
  { idx: 61, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_030641_e2d6fb1d-f0bf-439b-b51d-2925e32d57c4.png" },
  { idx: 62, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_030641_96983d48-537c-49ed-8688-95d65d16f4d4.png" },
  { idx: 63, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_030641_fbea302a-7de2-4f3a-aaa5-0c6967a1047b.png" },
  { idx: 64, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_030641_6550023d-1d4f-4711-a723-a1a528292d96.png" },
  { idx: 65, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_030641_8e0dd7b8-1f26-4654-800c-712a9fd7217b.png" },
  { idx: 66, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_030641_c78db5aa-48cd-4414-8f9e-1fe11d900ab3.png" },
  { idx: 67, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_030641_f74d5174-f298-4174-b169-e6b55c34cd06.png" },
  { idx: 68, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_030641_48331533-b42e-44c1-adee-ab1983b03627.png" },
  { idx: 69, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_030641_5ae6425d-bcfb-451e-b158-cc7796117947.png" },
  { idx: 70, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_030641_2ecdc759-599a-4ae6-b7d0-9a8a9d6f1f98.png" },
  { idx: 71, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_030641_163dd4a4-7f42-459c-9938-215228b86e6f.png" },
  { idx: 72, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_030650_0b8c66c3-6a5a-480f-8054-5599104824b2.png" },
  { idx: 73, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_030650_fc43eada-20ae-4603-b225-05dc5da17c48.png" },
  { idx: 74, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_030650_b11bf7ea-e5f2-4288-9e9d-7ff185064421.png" },
  { idx: 75, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_031940_2244f470-c31b-4ae1-bc6f-0113ff1a5321.png" },
  { idx: 76, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_031940_f1699293-1ea5-4b92-9cf3-36bea35b0d80.png" },
  { idx: 77, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_031940_55ff34b4-0b63-458a-a820-6a6b78436895.png" },
  { idx: 78, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_031940_24b97369-a9a4-4987-8d52-c38b8f3faf76.png" },
  { idx: 79, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_031940_ba6baf73-2024-4ea5-9ae0-093d4cb262e6.png" },
  { idx: 80, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_031940_0f49c3e8-1ac9-4335-a391-83d17d1bd3ed.png" },
  { idx: 81, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_031940_691d70b1-2b8d-42f8-849d-26e1d46f614d.png" },
  { idx: 82, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_031940_5f4e6601-1c58-4b26-b182-64e4ba616219.png" },
  { idx: 83, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_031940_6e7f7c92-25bd-4494-ad76-ca803f06796b.png" },
  { idx: 84, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_031940_b7dca187-a5b4-443a-8e46-440209a36f59.png" },
  { idx: 85, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_031940_49680cc6-effe-47ea-9a13-1009500a9f7a.png" },
  { idx: 86, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_031940_f3e7ba08-5021-4ad6-bbab-b635af2a2f79.png" },
  { idx: 87, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_031949_3935740d-20fe-4cb4-a2ce-93973509ea47.png" },
  { idx: 88, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_031949_3261ee4a-ed69-46c1-9bd0-74cb16dbc6a1.png" },
  { idx: 89, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_031949_d826cd41-93fb-4907-993d-77fbc2f3161e.png" },
  { idx: 90, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_032659_830e80c3-2f5b-4432-9827-d35f8c3eba95.png" },
  { idx: 91, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_032659_7b085042-f774-4903-931c-4734f6325290.png" },
  { idx: 92, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_032659_9b199db9-0c5e-4361-9f0f-fbacd163dc9c.png" },
  { idx: 93, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_032659_93bd3f3f-502c-4adf-8533-60d2d06e286f.png" },
  { idx: 94, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_032659_b0e6f6ee-af99-40d6-a003-d6f06a4cf2ff.png" },
  { idx: 95, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_032659_87b8fcf0-ad2d-4cb0-84d4-2fbf44d61457.png" },
  { idx: 96, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_032659_5c6f29ca-015d-4fe4-aff1-eadc2b643d4c.png" },
  { idx: 97, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_032659_2a382304-2632-4032-b946-cd0272d45260.png" },
  { idx: 98, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_032659_962f0730-86b0-400d-bf60-7d185635e22c.png" },
  { idx: 99, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_032659_f0a955e8-fea5-4fc7-b650-a2f874d1c061.png" },
  { idx: 100, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_032659_bd365166-0bef-4090-9126-5a27efa784c0.png" },
  { idx: 101, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_032659_ca8368cd-a4e5-4c3d-91e4-34a1f0787330.png" },
  { idx: 102, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_032707_445ae2dd-7b56-4555-9f10-b008eb3b0d1d.png" },
  { idx: 103, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_032707_6889871b-e653-4f48-a151-a9c855b01397.png" },
  { idx: 104, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_032707_0a87b0b7-6b76-4678-a4f0-0b06bdc3c865.png" },
  { idx: 105, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_033138_c8c79892-7060-4764-bb9b-39dfd468a14d.png" },
  { idx: 106, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_033138_d27f1cc6-ddf2-4b64-99da-a3e02e855dc2.png" },
  { idx: 107, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_033138_19b36099-6712-4930-bd37-d381dd5224a8.png" },
  { idx: 108, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_033138_3476139b-a2f1-4702-8ca6-72d939296dde.png" },
  { idx: 109, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_033138_ddf6eb94-6666-4a34-bcb4-0f3b5819da09.png" },
  { idx: 110, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_033138_1be4d5b8-01cc-4633-9367-6dc83ffd809b.png" },
  { idx: 111, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_033138_391a2ff2-72da-489a-b873-e67692899aec.png" },
  { idx: 112, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_033138_40cdeb30-6b81-4e40-a2aa-5591483dc20d.png" },
  { idx: 113, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_033138_95e4bbf2-162d-45ae-b75d-6b637228a3ea.png" },
  { idx: 114, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_033138_09cf4899-2900-418c-b945-248e18813752.png" },
  { idx: 115, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_033138_fe750cdf-2c44-41c3-b671-a1d026b18639.png" },
  { idx: 116, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_033138_cbd20172-0443-4f38-9375-974fdf341bc6.png" },
  { idx: 117, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_033146_fd29b434-78e1-49ca-a5be-ee54b03f6913.png" },
  { idx: 118, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_033146_f6df3845-5b35-4484-8e92-11e8b09e204b.png" },
  { idx: 119, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_033146_295388ff-561d-4826-837e-e8b262e1c0ea.png" },
  { idx: 120, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034234_9a3e3fab-5580-41b8-857c-3834d4301226.png" },
  { idx: 121, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034234_6eeb541a-ba74-407e-a9f7-fa9c023629c7.png" },
  { idx: 122, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034234_313a47db-8d61-4be7-b8d8-84f8b1e74ae0.png" },
  { idx: 123, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034234_8a028c41-5d8e-450a-9249-e34750646fe5.png" },
  { idx: 124, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034234_9812908e-8fd0-406c-9f17-01fb10c4c728.png" },
  { idx: 125, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034234_934fe7d8-8c64-41ec-b994-fac68e2dd751.png" },
  { idx: 126, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034234_a6cb576c-45b5-4073-9b46-3fad93ba3f6e.png" },
  { idx: 127, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034234_8010cc55-dbc0-4791-a612-899942a75c45.png" },
  { idx: 128, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034234_53345a0f-81dc-49ec-8b6f-af8bab66c3ed.png" },
  { idx: 129, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034234_c25b9d51-7137-46ef-956f-33ac42ba61b2.png" },
  { idx: 130, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034234_0d272b2b-59cb-4dea-9b42-fa5c4e08bcf2.png" },
  { idx: 131, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034234_6a4b8030-1ba4-4942-a779-2383d4ee40cd.png" },
  { idx: 132, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034242_6218bb78-a784-4767-8b37-9b1e5cb7239f.png" },
  { idx: 133, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034242_5acdd153-e569-4631-9d21-63f766f98d31.png" },
  { idx: 134, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034242_f9c97d3d-f1c1-480a-b884-6d3b13e1d0f8.png" },
  { idx: 135, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034517_73efb300-a19a-47cc-923f-bfd964421f63.png" },
  { idx: 136, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034516_9e0acafe-74cd-429d-af70-0c6833e0696c.png" },
  { idx: 137, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034516_253a7169-2133-4d93-b130-f17c7960685b.png" },
  { idx: 138, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034518_29553989-9e6e-4d80-a6fe-a0f931af875a.png" },
  { idx: 139, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034517_e833bce1-aa0a-4e68-82e2-1bae8ba162d3.png" },
  { idx: 140, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034516_e88cad5a-6b3a-47bc-95a3-a5ad03bed39c.png" },
  { idx: 141, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034517_bec4cb21-e46e-4b35-950d-2bd164391d9e.png" },
  { idx: 142, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034517_63f40b9b-5c3a-47bf-a115-55376dee4510.png" },
  { idx: 143, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034516_97e4a4fc-6804-49a5-9351-2ba0dd187177.png" },
  { idx: 144, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034517_7bf3e71d-363d-4780-b3b5-141a2160d6c7.png" },
  { idx: 145, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034517_c42e5e0b-0ef8-40ec-915b-a811f2d608fe.png" },
  { idx: 146, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034516_5dd668b1-c34f-4a25-980a-be29d70a5b4b.png" },
  { idx: 147, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034526_3c65cbca-0757-456b-af15-ebb2a35d3ae2.png" },
  { idx: 148, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034526_b173216d-caf9-4134-bb44-979dd56671e4.png" },
  { idx: 149, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_034526_85e012ce-d77a-4e2a-8098-fef888e30519.png" },
  { idx: 150, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165551_453c9543-2fbf-4328-af39-4c1eb68fee3d.png" },
  { idx: 151, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165551_4c88ead5-83a7-4701-87d5-3e1e4af5165b.png" },
  { idx: 152, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165551_8da12354-eb96-484f-9301-2c93ee5e1288.png" },
  { idx: 153, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165551_1cc563bd-0b44-421b-bf84-12fb6d92e226.png" },
  { idx: 154, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165551_4517cff4-c641-4d42-bf58-90a2ed4af843.png" },
  { idx: 155, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165551_057f3499-1cee-4fe4-b29e-3a16a0e79c8f.png" },
  { idx: 156, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165551_ec995598-cfea-462d-863a-3fce5537b149.png" },
  { idx: 157, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165551_8b3ababb-2dd5-4759-a28b-0da1f5f61ceb.png" },
  { idx: 158, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165551_3511e6c9-038c-4337-b0fa-dcc4f8daeeae.png" },
  { idx: 159, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165551_7d5e4b21-0977-4113-8018-9ab7416bcb91.png" },
  { idx: 160, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165551_90d6367b-7d89-48ac-9057-897a187e5289.png" },
  { idx: 161, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165551_677e7b8e-a48c-460f-a4a9-201b08b4406b.png" },
  { idx: 162, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165602_fcdd7ef4-d888-4d07-982d-ac8643e4d872.png" },
  { idx: 163, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165602_5e569b9e-22a8-43da-b0a5-c653a9cc5562.png" },
  { idx: 164, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165602_fa7f0973-d720-404d-b96e-7d3d4326bc11.png" },
  { idx: 165, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165602_b7b9e0ac-fd30-4895-802e-a9fe9cf429ca.png" },
  { idx: 166, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165602_4eb2de0e-30ab-49c8-9266-3ec3c5d8bd15.png" },
  { idx: 167, url: "https://d8j0ntlcm91z4.cloudfront.net/user_2y0VJSMJy146DOCkThGxh8PK78v/hf_20260829_165602_a16a099a-be79-4e91-9426-81c9583c6160.png" },];

function descargarImagen(url, destino) {
  return new Promise((resolve, reject) => {
    const archivo = fs.createWriteStream(destino);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (respuesta) => {
      if (respuesta.statusCode !== 200) {
        archivo.close();
        fs.unlink(destino, () => {});
        reject(new Error(`Código de estado HTTP: ${respuesta.statusCode}`));
        return;
      }
      respuesta.pipe(archivo);
      archivo.on('finish', () => {
        archivo.close();
        resolve();
      });
    }).on('error', (err) => {
      archivo.close();
      fs.unlink(destino, () => {});
      reject(err);
    });
  });
}

async function main() {
  const total = ESCENAS.length;
  let ok = 0;
  const fallidas = [];

  console.log(`Descargando ${total} escenas...\n`);

  for (const { idx, url } of ESCENAS) {
    const nombreArchivo = `escena_${String(idx).padStart(3, '0')}.png`;
    const destino = path.join(__dirname, nombreArchivo);

    if (fs.existsSync(destino)) {
      console.log(`[${idx + 1}/${total}] ${nombreArchivo} ya existe, se omite.`);
      ok++;
      continue;
    }

    try {
      await descargarImagen(url, destino);
      console.log(`[${idx + 1}/${total}] Descargada: ${nombreArchivo}`);
      ok++;
    } catch (err) {
      console.log(`[${idx + 1}/${total}] ERROR descargando escena ${idx}: ${err.message}`);
      fallidas.push(idx);
    }

    // pequeña pausa para no saturar el servidor
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`\nListo: ${ok}/${total} imágenes descargadas correctamente.`);
  if (fallidas.length > 0) {
    console.log(`Fallaron estas escenas (vuelve a correr el script para reintentarlas): ${fallidas.join(', ')}`);
  }
}

main();
