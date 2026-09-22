# ==========================================
# Stage 1: Build Static Binaries
# ==========================================
FROM golang:1.22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache ca-certificates git

# Download dependencies first for caching
COPY go.mod go.sum* ./
RUN go mod download || true

# Copy source code
COPY . .
RUN go mod tidy

# Compile lean, static binaries without CGO and strip symbols (-s -w)
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /bin/sentinel ./cmd/sentinel
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /bin/primary-mock ./cmd/primary-mock
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /bin/secondary-mock ./cmd/secondary-mock

# ==========================================
# Stage 2: Minimal Production Image (<20MB)
# ==========================================
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata curl

# Run as non-root user for security
RUN adduser -D -u 10001 sentinel
USER sentinel

WORKDIR /home/sentinel

# Copy compiled binaries from builder stage
COPY --from=builder /bin/sentinel /usr/local/bin/sentinel
COPY --from=builder /bin/primary-mock /usr/local/bin/primary-mock
COPY --from=builder /bin/secondary-mock /usr/local/bin/secondary-mock

EXPOSE 8080

ENTRYPOINT ["sentinel"]
