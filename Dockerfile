FROM node:18

WORKDIR /app

# install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "start"]
