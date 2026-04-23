FROM node:18

WORKDIR /app

# install ffmpeg (required)
RUN apt-get update && apt-get install -y ffmpeg

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "start"]

EXPOSE 3000
