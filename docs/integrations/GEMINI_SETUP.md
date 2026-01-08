# Google Gemini API Setup Guide

This guide will help you set up the Gemini API to use **Nano Banana** (Gemini 2.5 Flash Image) and **Veo 3.1** in Latentia.

## Quick Setup (2 minutes!)

### Step 1: Get Your API Key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Click **"Get API Key"** or **"Create API key"**
3. Choose **"Create API key in new project"** (or use existing project)
4. Copy the API key (starts with `AIza...`)

That's it! No complex setup, no billing required to start.

### Step 2: Add to Your Environment

Add this line to your `.env.local` file:

```env
# Google Gemini API Key
GEMINI_API_KEY=your-api-key-here
```

Replace `your-api-key-here` with the API key you copied.

### Step 3: Restart Your Server

```bash
npm run dev
```

### Step 4: Test It!

1. Open Latentia at `http://localhost:3000`
2. Go to a project
3. Click the **Model Picker** → Select **"Nano Banana"** or **"Veo 3.1"**
4. Enter a prompt like: *"A serene mountain landscape at sunset"*
5. Click **Generate** ✨

---

## Available Models

### 🎨 Nano Banana (Gemini 2.5 Flash Image)
- **Type**: Image generation
- **Quality**: Highly effective and precise
- **Speed**: Fast
- **Cost**: ~$0.01 per image
- **Best for**: High-quality images, precise control

### 🎬 Veo 3.1
- **Type**: Video generation
- **Quality**: State-of-the-art with native audio
- **Speed**: Moderate
- **Cost**: ~$0.05 per second
- **Best for**: Professional video content

---

## Pricing

### Free Tier
- **15 requests per minute**
- **1,500 requests per day**
- **1 million tokens per month** (for text)
- Perfect for development and testing!

### Paid Plans
Once you exceed free tier:
- **Nano Banana**: ~$0.01 per image
- **Veo 3.1**: ~$0.05 per second of video
- Much cheaper than competitors!

---

## Rate Limits

**Free Tier:**
- 15 RPM (requests per minute)
- 1,500 RPD (requests per day)

**Paid Plans:**
- 2,000 RPM
- 10,000+ RPD

**Tips to avoid limits:**
- Generate 1-2 images at a time during testing
- Use a paid API key for production
- Implement rate limiting in your app

---

## Troubleshooting

### "API key not valid" error
- Check your API key is correct
- Make sure it's in `.env.local` (not `.env.example`)
- Restart your dev server

### "Quota exceeded" error
- You've hit the free tier limits
- Wait for the quota to reset (daily)
- Or upgrade to a paid plan

### "Model not found" error
- Make sure you're using the latest Gemini API
- Check the model IDs are correct
- Some models may require early access

### Images not showing
- Check browser console for errors
- Base64 images are large - may take time to load
- Consider implementing image storage (Supabase Storage)

---

## Security Best Practices

1. **Never commit your API key** to Git
   - `.env.local` is already in `.gitignore`

2. **Use environment variables**
   ```env
   GEMINI_API_KEY=your-key-here
   ```

3. **Implement rate limiting** in production
   - Prevent abuse
   - Track usage per user

4. **Monitor your usage**
   - Check [Google AI Studio](https://aistudio.google.com/) dashboard
   - Set up billing alerts

---

## Advanced: Production Deployment

When deploying to Vercel:

1. Go to your Vercel project → **Settings** → **Environment Variables**
2. Add: `GEMINI_API_KEY` = `your-key-here`
3. Redeploy your app

---

## Useful Links

- [Gemini API Docs](https://ai.google.dev/gemini-api/docs)
- [Get API Key](https://aistudio.google.com/apikey)
- [Pricing](https://ai.google.dev/pricing)
- [Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits)

---

## Next Steps

Once you have Gemini working:
- Add more models (OpenAI DALL-E, Stability AI, etc.)
- Implement image storage (Supabase Storage)
- Add generation history
- Build real-time updates

**Happy generating!** 🎨✨

