-- CreateTable
CREATE TABLE "project_chats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New Chat',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chat_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_chats_project_id_user_id_idx" ON "project_chats"("project_id", "user_id");

-- CreateIndex
CREATE INDEX "project_chats_user_id_idx" ON "project_chats"("user_id");

-- CreateIndex
CREATE INDEX "project_chat_messages_chat_id_idx" ON "project_chat_messages"("chat_id");

-- AddForeignKey
ALTER TABLE "project_chats" ADD CONSTRAINT "project_chats_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_chats" ADD CONSTRAINT "project_chats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_chat_messages" ADD CONSTRAINT "project_chat_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "project_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

